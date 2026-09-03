import { buildTG11ViewModel, buildTG12ViewModel } from './formViewModel';
import { hrSettingsService } from '../../services/hrSettingsService';
import { signatureService } from '../../services/signatureService';
import QRCode from 'qrcode';

const getHtmlTemplate = (dataObj) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TG-11 &amp; TG-12</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
  :root {
    --page: #FFFFFF; --ink: #37352F; --ink-2: rgba(55, 53, 47, .70); --ink-3: rgba(55, 53, 47, .46);
    --line: rgba(55, 53, 47, .10); --line-2: rgba(55, 53, 47, .17); --tint: #F7F6F3;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;
    --sans: "Geist", ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { background: var(--page); color: var(--ink); margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter portrait; margin: 0; }
  
  .paper { background: #FFFFFF; position: relative; width: 816px; height: 1056px; overflow: hidden; margin: 0 auto; }
  .land { position: absolute; left: 0; width: 816px; height: 528px; }
  .land.a { top: 0; } .land.b { top: 528px; }
  
  .cutline { position: absolute; left: 0; right: 0; top: 528px; border-top: 1px dashed #C6C1B8; }
  
  .form {
    --f-ink: #221F1A; --f-2: #4A463F; --f-3: #6E6A61;
    --f-rule: #C6C1B8; --f-hair: #E3E0D9; --f-well: #F2F0EA;
    width: 100%; height: 100%; padding: 28px 40px 20px;
    color: var(--f-ink); font-family: var(--sans); font-size: 12px; line-height: 1.4;
    display: flex; flex-direction: column;
  }
  .m { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .k { font-size: 7.5px; line-height: 1.3; font-weight: 500; letter-spacing: .155em; text-transform: uppercase; color: var(--f-3); }
  
  .rail { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--f-rule); }
  .mark { width: 27px; height: 23px; flex: 0 0 27px; color: var(--f-ink); }
  .mark svg { display: block; width: 100%; height: 100%; }
  .rail .org { font-size: 7.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--f-3); line-height: 1.55; font-weight: 500; }
  .rail .org b { display: block; font-size: 9.5px; letter-spacing: .155em; color: var(--f-2); font-weight: 600; }
  .rail .sp { flex: 1; }
  .rail .id { text-align: right; line-height: 1.45; }
  .rail .id .n { font-size: 13px; font-weight: 600; letter-spacing: .03em; }
  .rail .id .r { font-size: 9px; color: var(--f-3); letter-spacing: .05em; }
  
  .head { display: flex; align-items: flex-end; gap: 28px; padding: 15px 0 14px; border-bottom: 1px solid var(--f-rule); }
  .head .l { flex: 1 1 auto; min-width: 0; }
  .head .kind { font-size: 10.5px; line-height: 1.3; font-weight: 600; letter-spacing: .19em; text-transform: uppercase; color: var(--f-ink); }
  .head .who { font-family: var(--serif); font-size: 25px; font-weight: 500; letter-spacing: -.017em; line-height: 1.12; margin-top: 9px; }
  .head .meta { font-size: 10.5px; line-height: 1.3; color: var(--f-2); margin-top: 5px; letter-spacing: .002em; }
  .head .r { flex: 0 0 auto; text-align: right; }
  .head .big { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 31px; font-weight: 500; letter-spacing: -.035em; line-height: 1; margin-top: 8px; }
  .head .big em { font-style: normal; font-size: 12px; font-weight: 400; color: var(--f-2); margin-left: 6px; letter-spacing: 0; }
  .head .ledger { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 9.5px; line-height: 1.3; color: var(--f-3); margin-top: 7px; letter-spacing: .01em; }
  .strike { text-decoration: line-through; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  
  .cols { display: flex; gap: 24px; padding-top: 15px; flex: 1; min-height: 0; }
  .cL { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .cR { flex: 0 0 214px; padding-left: 24px; border-left: 1px solid var(--f-hair); display: flex; flex-direction: column; gap: 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px 20px; }
  .f .v { font-size: 12.5px; line-height: 1.3; font-weight: 500; margin-top: 4px; letter-spacing: -.004em; }
  .f .x { font-size: 9.5px; line-height: 1.35; color: var(--f-3); margin-top: 2px; }
  .rem { margin-top: auto; padding-top: 13px; }
  .rem p { margin: 7px 0 0; font-family: var(--serif); font-style: italic; font-size: 13px; line-height: 1.55; color: var(--f-2); max-width: 46ch; }
  
  .blk .v { font-size: 12px; line-height: 1.3; font-weight: 600; margin-top: 5px; display: flex; align-items: center; gap: 7px; letter-spacing: -.004em; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--f-ink); flex: 0 0 5px; }
  .rows { margin-top: 8px; display: grid; gap: 7px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 10px; line-height: 1.3; }
  .row .a { color: var(--f-3); white-space: nowrap; }
  .row .b2 { font-weight: 500; text-align: right; }
  
  .band { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--f-rule); display: flex; gap: 26px; align-items: flex-start; }
  .sigs { flex: 1; display: grid; gap: 22px; }
  .sigs.n2 { grid-template-columns: 1fr 1fr; }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); }
  .sig .plate { height: 30px; margin-top: 6px; border-bottom: 1px solid var(--f-rule); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px; }
  .sig.awaiting .plate { background: var(--f-well); }
  .sig .who { margin-top: 6px; font-size: 10.5px; line-height: 1.3; font-weight: 600; letter-spacing: -.008em; }
  .sig .role { font-size: 7.5px; line-height: 1.3; letter-spacing: .08em; text-transform: uppercase; color: var(--f-3); margin-top: 3px; }
  .sig .stamp, .sig .pending { font-family: var(--mono); font-size: 7px; line-height: 1.3; margin-top: 4px; letter-spacing: .02em; }
  .sig .stamp { color: var(--f-2); }
  .sig .pending { color: var(--f-3); letter-spacing: .12em; text-transform: uppercase; }
  .sig .plate img { max-height: 24px; max-width: 100%; object-fit: contain; }
  .sig .plate .printed-name { font-family: var(--serif); font-size: 16px; font-weight: 500; font-style: italic; margin-bottom: 2px; color: var(--f-ink); }
  
  .verify { flex: 0 0 188px; display: flex; gap: 11px; }
  .qr { width: 52px; height: 52px; flex: 0 0 52px; }
  .verify .u { font-family: var(--mono); font-size: 7.5px; line-height: 1.5; color: var(--f-2); word-break: break-all; }
  .verify .h { font-size: 7px; line-height: 1.45; color: var(--f-3); margin-top: 5px; }
  .note { margin-top: 11px; padding-top: 8px; border-top: 1px solid var(--f-hair); font-size: 7.5px; line-height: 1.35; color: var(--f-3); letter-spacing: .03em; }
  
  .blank { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; font-family: var(--mono); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: #A8A399; }
</style>
</head>
<body>
  <div id="pages"></div>
  <script>
    const DATA = ${JSON.stringify(dataObj)};
    
    var MARK = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="204 177 650 550" role="img" aria-label="T3CKGROUP">
      <path d="M492.51 240.23C492.91 240.97 492.53 241.46 493.45 241.96C495.1 242.87 508.27 242.24 511.06 242.25C530.08 242.31 549.09 242.16 568.11 242.18C632.01 242.23 695.92 241.89 759.82 242.13C776.65 242.2 793.48 242.21 810.32 242.1C815 242.06 825.21 243.53 828.76 240.84C827.84 246.58 824.24 252.21 821.99 257.65C818.53 266.04 815.56 274.69 811.94 283.01C810.26 286.89 808.16 290.61 806.56 294.54C803.77 301.39 801.24 311.91 796.63 317.49C783.01 318.59 768.84 317.65 755.14 317.69C723.03 317.81 690.93 317.84 658.82 317.86C646.35 317.87 633.89 317.91 621.41 317.76C616.52 317.7 609.38 316.33 605.07 318.83C604.78 318.34 604.89 317.74 604.27 317.47C601.72 316.35 592.79 317.18 589.62 317.17C573.46 317.1 557.13 316.8 540.99 317.41C536.8 322.42 533.82 334.35 531.05 340.78C523.06 359.37 515.47 378.12 507.47 396.71C481.23 457.69 456.33 519.24 430.24 580.29C421.53 600.69 413.65 621.47 404.6 641.72C402.45 646.53 400.62 651.4 398.71 656.3C397.7 658.9 395.97 661.24 397.25 663.89C393.14 666.46 390.6 676.47 388.83 681.11C385.64 689.5 381.65 697.57 378.03 705.78C375.49 711.54 373.63 717.62 370.79 723.25C365.75 725.3 347.54 723.73 340.87 723.88C315.32 724.44 289.73 723.89 264.18 724.01C255.77 724.05 247.34 724.23 238.93 723.92C235.16 723.79 231.02 724.32 227.71 722.63C230.5 711.05 236.9 699.94 241.56 688.99C249.35 670.7 256.43 652.17 264.02 633.8C266.89 626.84 270.49 620.14 273.23 613.1C284.71 583.5 297.33 554.43 309.77 525.28C312.42 519.08 314.42 512.64 316.93 506.4C327.26 480.73 338.3 455.39 349.01 429.88C359.88 404.01 370.86 378.38 380.76 352.27C383.69 344.54 387.52 337.09 390.69 329.45C392.12 326 394.34 321.91 394.17 318.2C331.83 317.92 269.48 317.63 207.14 317.35C206.03 311.02 212.64 300.35 215.18 294.14C217.67 288.1 219.6 281.8 222.05 275.74C224.43 269.82 227.36 264.17 229.63 258.18C231.65 252.84 233.51 247.21 236.13 242.14C242.42 240.59 251.87 241.78 258.59 241.81C272.61 241.89 286.62 241.7 300.65 241.8C342.69 242.1 384.73 241.45 426.76 241.73C442.69 241.84 458.64 241.36 474.57 241.7C478.85 241.79 489.82 243.24 492.51 240.23Z" fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="0.25" stroke-linejoin="round" />
      <path opacity="0.28" d="M828.76 240.84C825.21 243.53 815 242.06 810.32 242.1C793.48 242.21 776.65 242.2 759.82 242.13C695.92 241.89 632.01 242.23 568.11 242.18C549.09 242.16 530.08 242.31 511.06 242.25C508.27 242.24 495.1 242.87 493.45 241.96C492.53 241.46 492.91 240.97 492.51 240.23C500.61 220.47 508.71 200.71 516.81 180.95C524.58 179.21 533.93 180.14 541.93 180.4C556.17 180.85 570.7 180.72 584.94 180.32C614.79 179.48 644.84 180.26 674.72 180.34C695.29 180.4 715.88 179.8 736.44 180.27C752.02 180.63 767.62 180.15 783.2 180.15C793.79 180.14 804.4 180.58 814.99 180.34C822.76 180.17 830.58 180.34 838.37 180.36C842.94 180.36 847.72 179.87 852.12 180.95C844.33 200.92 836.55 220.88 828.76 240.84ZM605.07 318.83C576.23 388.45 547.39 458.07 518.55 527.68C534.13 527.72 549.72 527.76 565.3 527.79C568.37 523.1 569.67 517.56 571.84 512.42C576.39 501.68 580.45 490.7 585.2 480.03C587.65 474.52 594.61 460.14 594.41 454.96C587.82 454.96 581.24 454.96 574.65 454.96C574.58 454.32 574.14 453.75 574.14 453.11C574.13 451.53 575.78 449.23 576.37 447.76C578.65 442.06 581.04 434.46 584.94 429.83C586.97 429.64 588.99 429.45 591.02 429.25C591.18 429.57 591.33 429.89 591.49 430.2C593.36 430.22 595.23 430.23 597.1 430.25C597.26 429.92 597.41 429.58 597.57 429.25C597.88 429.25 598.19 429.25 598.5 429.24C598.66 429.59 598.81 429.94 598.97 430.28C603.96 430.26 608.94 430.23 613.93 430.21C614.09 429.91 614.24 429.62 614.4 429.32C614.71 429.32 615.02 429.32 615.34 429.32C619.05 431.68 633.1 430.27 638.25 430.22C657.88 430.05 677.53 430.23 697.16 430.25C702.49 430.25 717.29 431.76 721.01 429.17C730.59 429.66 740.17 430.15 749.75 430.64C719.13 508.31 688.51 585.97 657.88 663.64C571.01 663.72 484.13 663.8 397.25 663.89C395.97 661.24 397.7 658.9 398.71 656.3C400.62 651.4 402.45 646.53 404.6 641.72C413.65 621.47 421.53 600.69 430.24 580.29C456.33 519.24 481.23 457.69 507.47 396.71C515.47 378.12 523.06 359.37 531.05 340.78C533.82 334.35 536.8 322.42 540.99 317.41C557.13 316.8 573.46 317.1 589.62 317.17C592.79 317.18 601.72 316.35 604.27 317.47C604.89 317.74 604.78 318.34 605.07 318.83Z" fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="0.25" stroke-linejoin="round" />
    </svg>\`;
    
    function sigBlock(s) {
      var awaiting = s.state === 'wet' || s.state === 'awaiting';
      var plateContent = '';
      if (!awaiting) {
        if (s.signatureBase64) {
          plateContent = '<img src="' + s.signatureBase64 + '" />';
        } else {
          plateContent = '<div class="printed-name">' + s.who + '</div>';
        }
      }
      return '<div class="sig' + (awaiting ? ' awaiting' : '') + '">'
        + '<div class="k">' + s.role + '</div>'
        + '<div class="plate">' + plateContent + '</div>'
        + '<div class="who">' + s.who + '</div>'
        + '<div class="role">' + s.title + '</div>'
        + (awaiting ? '<div class="pending">Signature required</div>'
          : '<div class="stamp">' + (s.stamp || 'signed on paper') + '</div>')
        + '</div>';
    }

    function formHTML(d) {
      return '<div class="form">'
        + '<header class="rail"><span class="mark">' + MARK + '</span>'
        + '<span class="org"><b>T3CKGROUP</b>Human resources department</span>'
        + '<span class="sp"></span>'
        + '<span class="id"><span class="n m">' + d.recordNo + '</span><span class="r m" style="display:block">' + (d.recordNo.includes('LV') ? 'TG-11' : 'TG-12') + '</span></span>'
        + '</header>'
        + '<div class="head">'
        + '<div class="l"><div class="kind">' + d.kind + '</div><div class="who">' + d.name + '</div><div class="meta">' + d.meta + '</div></div>'
        + '<div class="r"><div class="k">' + d.bigK + '</div>'
        + '<div class="big">' + d.bigN + '<em>' + d.bigU + '</em></div>'
        + '<div class="ledger">' + (d.ledger || (d.requestedHours ? 'Requested <span class="strike">' + d.requestedHours + '</span> · credited ' + d.bigN + ' hrs' : '')) + '</div></div>'
        + '</div>'
        + '<div class="cols">'
        + '<div class="cL">'
        + '<div class="grid">' + d.fields.map(function (f) {
            return '<div class="f"><div class="k">' + f.k + '</div><div class="v ' + (f.v.match(/<span/)?'':'m') + '">' + f.v + '</div>' + (f.x ? '<div class="x">' + f.x + '</div>' : '') + '</div>';
          }).join('') + '</div>'
        + '<div class="rem"><div class="k">' + d.remK + '</div><p>' + d.rem + '</p></div>'
        + '</div>'
        + '<div class="cR">'
        + '<div class="blk"><div class="k">Outcome</div><div class="v"><span class="dot"></span>' + d.outcome + '</div></div>'
        + '<div class="blk"><div class="k">HRD validation</div><div class="rows">'
        + d.hrd.map(function (h) { return '<div class="row"><span class="a">' + h[0] + '</span><span class="b2 m">' + h[1] + '</span></div>'; }).join('')
        + '</div></div>'
        + '</div></div>'
        + '<div class="band">'
        + '<div class="sigs n' + d.sigs.length + '">' + d.sigs.map(function (s) { return sigBlock(s); }).join('') + '</div>'
        + '<div class="verify"><img class="qr" src="' + d.qrDataUrl + '" alt="QR Code" />'
        + '<div><div class="u m">' + d.qrText + '</div>'
        + '<div class="h">Scan for this record’s live status. Anyone may verify it; the reason and attachments open only for HR and the employee.</div></div></div>'
        + '</div>'
        + '<div class="note">' + d.note + '</div>'
        + '</div>';
    }

    function renderSheets() {
      let html = '';
      for (let i = 0; i < DATA.length; i += 2) {
        const topForm = DATA[i];
        const botForm = DATA[i + 1];
        
        html += '<div class="paper">';
        html += '<div class="land a">' + formHTML(topForm) + '</div>';
        
        if (botForm) {
          html += '<div class="land b">' + formHTML(botForm) + '</div>';
        } else {
          const kind = topForm.recordNo.includes('LV') ? 'TG-11' : 'TG-12';
          html += '<div class="land b"><div class="blank">Blank ' + kind + '</div></div>';
        }
        
        html += '<div class="cutline"></div>';
        html += '</div>';
      }
      document.getElementById('pages').innerHTML = html;
    }
    
    renderSheets();
  </script>
</body>
</html>`;

export async function printHtmlPdf(records) {
  const formSettings = await hrSettingsService.getFormSettings().catch(() => null);
  
  const mappedData = records.map(r => {
    return r.type === 'OVERTIME' 
      ? buildTG12ViewModel(r, formSettings)
      : buildTG11ViewModel(r, formSettings);
  });

  // Hydrate the view models with QR Code URLs and actual Signature images
  for (const d of mappedData) {
    const origin = window.location.hostname === 'localhost' ? 'http://localhost:5173' : 'https://t3ckgroup-erp.online';
    const verifyUrl = `${origin}/verify/${d.verificationToken}`;
    d.qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, scale: 4, color: { dark: '#000000', light: '#FFFFFF' } });
    d.qrText = `${origin.replace(/^https?:\/\//, '')}/verify/${d.verificationToken}`;
    
    for (const s of d.sigs) {
      if (s.signaturePath) {
        try {
          const blob = await signatureService.downloadSignature(s.signaturePath);
          if (blob) {
            s.signatureBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {
          console.warn("Failed to load signature for", s.who, e);
        }
      }
    }
  }

  const html = getHtmlTemplate(mappedData);
  
  // Try dynamic import to avoid circular dependencies or import hoisting issues
  const { generatePDFEndpoint } = await import('./api');
  
  try {
    const pdfBytes = await generatePDFEndpoint(html);
    
    // Create a Blob from the PDF bytes
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    // Open the generated PDF in a new tab
    const pdfWindow = window.open(url, '_blank');
    if (!pdfWindow) {
      throw new Error('Popup blocked! Please allow popups to view the PDF.');
    }
  } catch (error) {
    console.error("PDFEndpoint generation failed, falling back to browser print:", error);
    
    // Fallback: Open print preview window
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Popup blocked! Please allow popups to print the form.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    // Wait briefly for fonts to load from Google Fonts, then print
    setTimeout(() => {
      printWindow.print();
    }, 750);
  }
}
