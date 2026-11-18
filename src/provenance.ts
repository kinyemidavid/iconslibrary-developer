export const svgReceiptStamp = (receiptId: string, canonicalSha256: string) =>
  `\n<!-- IconsLibrary issuance="${receiptId}" canonical-sha256="${canonicalSha256}" -->\n`;
