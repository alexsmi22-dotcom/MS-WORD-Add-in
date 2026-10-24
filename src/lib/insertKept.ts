// What the pane says when Word accepted a picture and kept none of it (v2.193.0). Pure: no Office.js.
//
// renderFigurePng steps the raster scale down while the PNG is over its payload size (1.4 MB of base64), but at 1×
// it sends whatever it has. Word can accept such a picture without error and keep nothing; the host counts the
// body's pictures before and after (wordFigures.ts insertFigurePng) and the pane says so instead of "inserted".

/** The payload size the raster loop aims under, in base64 characters (the pane's renderFigurePng MAX_BASE64). */
export const PNG_PAYLOAD_LIMIT = 1_400_000;

/** The error text for a picture Word did not keep; `base64Length` is the PNG payload that was sent. */
export function pictureNotKeptText(base64Length: number): string {
  const bytes = Math.max(0, Math.round((base64Length * 3) / 4));
  const mb = (bytes / 1_000_000).toFixed(1);
  const big = base64Length > PNG_PAYLOAD_LIMIT;
  return (
    `Word did not keep the figure (a ${mb} MB picture${big ? ", over the size Word reliably accepts" : ""}). ` +
    (big
      ? "Choose a narrower figure width or the “As drawn” style and insert again."
      : "Put the cursor in a body paragraph and insert again.")
  );
}
