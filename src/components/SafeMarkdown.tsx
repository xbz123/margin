import Markdown, { type Options } from 'react-markdown';

// Assistant text is not permission to load an image from its author's server.
export default function SafeMarkdown(props: Options) {
  return <Markdown {...props} disallowedElements={['img']} />;
}
