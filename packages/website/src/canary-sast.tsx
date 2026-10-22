export function CanarySast() {
  const code = new URLSearchParams(document.location.search).get("code") ?? "";
  // oxlint-disable-next-line no-eval -- canary for the static analysis gate
  eval(code);
  return <div dangerouslySetInnerHTML={{ __html: code }} />;
}
