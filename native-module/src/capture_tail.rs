// Ordering between a capture thread (producer) and the DSP loop that drains its ring
// buffer (lib.rs). A producer that fails pushes its last samples, stops, and only then
// publishes its error, so the error's publication happens after every push. A DSP pass
// that reads the error first and drains afterwards therefore sees every sample pushed
// before the failure. Draining first and reading the error afterwards can miss the
// samples pushed in between: the drain finds the ring empty, the producer pushes its
// last batch and fails, and the DSP reads the error and exits with that batch unread.

/// One DSP pass over the producer's output: reads the producer's failure, then drains
/// what it has pushed into `batch`. When this returns `Some`, `batch` together with
/// what earlier passes drained holds every sample the producer pushed; the caller
/// processes it before reporting the failure.
pub fn failure_then_drain<E>(
    failure: impl FnOnce() -> Option<E>,
    drain: impl FnOnce(&mut Vec<f32>),
    batch: &mut Vec<f32>,
) -> Option<E> {
    let failed = failure();
    drain(batch);
    failed
}

#[cfg(test)]
mod tests {
    use super::failure_then_drain;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use std::thread;

    // DSP passes until the producer's failure is seen; returns what was drained.
    fn run_dsp(mut pass: impl FnMut(&mut Vec<f32>) -> Option<String>) -> (Vec<f32>, Option<String>) {
        let mut drained = Vec::new();
        for _ in 0..1_000_000 {
            if let Some(e) = pass(&mut drained) {
                return (drained, Some(e));
            }
        }
        (drained, None)
    }

    #[test]
    fn last_batch_pushed_right_after_an_empty_drain_is_not_lost() {
        // The reviewed interleaving, made deterministic: the DSP's first drain finds the
        // ring empty; right after it, the producer pushes its last batch and fails.
        let ring: RefCell<VecDeque<f32>> = RefCell::new(VecDeque::new());
        let error: RefCell<Option<String>> = RefCell::new(None);
        let producer_acted = Cell::new(false);
        let (drained, failure) = run_dsp(|batch| {
            failure_then_drain(
                || error.borrow_mut().take(),
                |b| {
                    b.extend(ring.borrow_mut().drain(..));
                    if !producer_acted.replace(true) {
                        ring.borrow_mut().extend([0.25, 0.5, 0.75]);
                        *error.borrow_mut() = Some("endpoint invalidated".into());
                    }
                },
                batch,
            )
        });
        assert_eq!(failure.as_deref(), Some("endpoint invalidated"));
        assert_eq!(drained, vec![0.25, 0.5, 0.75], "the last batch must reach the DSP before the error");
    }

    // Pushes 0..total in small chunks, then fails, as the WASAPI capture thread does.
    fn produce(ring: &Mutex<VecDeque<f32>>, error: &Mutex<Option<String>>, total: usize, round: usize) {
        for chunk in (0..total).collect::<Vec<_>>().chunks(13) {
            ring.lock().unwrap().extend(chunk.iter().map(|&i| i as f32));
            thread::yield_now();
        }
        *error.lock().unwrap() = Some(format!("round {round}"));
    }

    #[test]
    fn threaded_producer_failure_never_drops_pushed_samples() {
        for round in 0..200 {
            let ring = Arc::new(Mutex::new(VecDeque::new()));
            let error = Arc::new(Mutex::new(None::<String>));
            let total = 1_000 + round * 7;
            let (producer_ring, producer_error) = (ring.clone(), error.clone());
            let producer = thread::spawn(move || produce(&producer_ring, &producer_error, total, round));
            let (drained, failure) = run_dsp(|batch| {
                failure_then_drain(
                    || error.lock().unwrap().take(),
                    |b| b.extend(ring.lock().unwrap().drain(..)),
                    batch,
                )
            });
            producer.join().unwrap();
            assert_eq!(failure, Some(format!("round {round}")));
            assert_eq!(drained.len(), total, "round {round}");
            assert!(drained.iter().enumerate().all(|(i, &s)| s == i as f32), "round {round}: order kept");
        }
    }
}
