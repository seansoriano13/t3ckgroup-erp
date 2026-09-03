export async function generatePDFEndpoint(htmlContent) {
  const apiKey = import.meta.env?.VITE_PDFENDPOINT_API_KEY;
  
  if (!apiKey) {
    throw new Error("Missing VITE_PDFENDPOINT_API_KEY in environment variables.");
  }

  const response = await fetch('https://api.pdfendpoint.com/v1/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      html: htmlContent,
      sandbox: true, // using sandbox for testing to not consume quota
      page_size: 'Letter',
      margin_top: '0in',
      margin_bottom: '0in',
      margin_left: '0in',
      margin_right: '0in',
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PDFEndpoint Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success || !result.data || !result.data.url) {
    throw new Error('PDFEndpoint failed to provide a URL: ' + JSON.stringify(result));
  }

  // Fetch the actual PDF bytes from the provided URL
  const pdfResponse = await fetch(result.data.url);
  if (!pdfResponse.ok) {
    throw new Error(`Failed to download PDF from endpoint: ${pdfResponse.status}`);
  }
  
  const buffer = await pdfResponse.arrayBuffer();
  return new Uint8Array(buffer);
}
