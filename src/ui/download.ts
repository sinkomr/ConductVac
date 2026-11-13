/** trigger a browser download of a Blob */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Safari starts the download asynchronously; revoking in the same task can cancel it
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
