# Read-only dependency follow-up, not a removal decision

At source checkpoint `45b11c5b`, `npm explain --json --offline --ignore-scripts`
was queried for the remaining npm candidates, with a separate temporary cache.
The installed dependency graph traces to these root dependencies:

| Exact unresolved candidate | Root dependency routes observed |
| --- | --- |
| @alcalzone/ansi-tokenize 0.1.3 | tap |
| @npmcli/agent 4.0.0 | tap |
| dingbat-to-unicode 1.0.1 | mammoth |
| eastasianwidth 0.2.0 | @google-cloud/speech, tap |
| err-code 2.0.3 | electron-builder, electron-rebuild, sqlite3 |
| format 0.2.2 | react-code-blocks, react-syntax-highlighter |
| react-remove-scroll-bar 2.3.8 | @radix-ui/react-dialog |
| screenshot-desktop 1.15.4 | screenshot-desktop |
| @tootallnate/once 1.1.2 | sqlite3 |
| stream-events 1.0.5 | @google-cloud/speech |
| stubs 3.0.0 | @google-cloud/speech |
| tr46 0.0.3 | @deepgram/sdk, @elevenlabs/elevenlabs-js, groq-sdk |

The query also returns once 2.0.1 via electron-rebuild; it is not the unresolved
1.1.2 instance and must not be substituted. Root routes can include development
tools and are not proof of production runtime reachability.

Quoted package specifiers for tap/sqlite3/screenshot-desktop were searched in
tracked JS/TS/JSON under electron, src, scripts, tests and package.json. Only
the three package.json declarations matched. This does not cover every possible
computed import, external consumer or untracked script. In S17's complete
inventory, no application dist/dist-electron source map was observed referring
to these packages. Seven tap source-map observations belong to tap's own shipped
node_modules files, not the application bundle. All three can still be physically
packaged because they are root production dependencies.

These findings justify a focused classification/reachability review; they do not
authorize dependency deletion, reclassification, overrides or package exclusion.
S17 expressly forbids inferring those actions from inventory work. Dependency
changes would need separate authorization and subsequent clean-install,
regression and actual-package verification. Such changes alone would not resolve
other candidates, native vendored licenses or source/relinking obligations.
