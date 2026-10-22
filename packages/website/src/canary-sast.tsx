export function CanarySast() {
  const code = document.location.hash.slice(1);
  // oxlint-disable-next-line no-eval -- canary for the static analysis gate
  eval(code);
  return <div dangerouslySetInnerHTML={{ __html: code }} />;
}
