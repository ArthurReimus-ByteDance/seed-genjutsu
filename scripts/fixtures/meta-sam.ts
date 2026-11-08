// Shared CLI/test fixture: synthetic SAM wire data, not model segmentation.
// The payload encodes a 20x20 one_bit mask filled with foreground pixels.
export function maskLine(
  frame = 0,
  width = 96,
  height = 64,
  objectId = 7,
  left = 20,
) {
  return `<${frame}f>${objectId}<|box;x1=${left};y1=16;x2=${left + 19};y2=35;w=${width};h=${height}|><|mask;x=0;y=0;data=20,20,!!!!!'y:P=c*$|>\n`;
}

export function segmentationEvents(output: string, complete = true) {
  const lane = { item_id: "msg_test", output_index: 0, content_index: 0 };
  return [
    { type: "response.created", response: { id: "resp_synthetic" } },
    { type: "response.output_text.delta", ...lane, delta: output },
    { type: "response.output_text.done", ...lane, text: output },
    ...(complete
      ? [
          {
            type: "response.completed",
            response: { id: "resp_synthetic", status: "completed" },
          },
        ]
      : []),
  ]
    .map(
      (value) =>
        "event: " + value.type + "\ndata: " + JSON.stringify(value) + "\n\n",
    )
    .join("");
}
