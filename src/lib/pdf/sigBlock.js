/**
 * The signature plate every printed form shares (ADR 0014): the HR forms' half
 * sheets and the A4 IPAS both draw their sign-offs through `sigBlock`, so a
 * stored signature, a name-only signer and a box still waiting read the same
 * on paper wherever they print.
 *
 * Kept free of I/O (no supabase, no QR) so view-model and composer tests can
 * import it without pulling the network layer in.
 */

/**
 * One signature-plate block: a real function (not a template-string script) so it's shared by the live preview and the final print/export output.
 *
 * `s` is `{ role, who, title, state, signatureBase64?, stamp? }`:
 *   state 'wet' | 'awaiting'  the box is still waiting: "Signature required"
 *   otherwise, with signatureBase64   the stored signature image
 *   otherwise                          the name only
 *
 * Nothing here is escaped: the HR view models are built from our own records.
 * A caller whose strings come from outside (the IPAS: Odoo and typed text)
 * escapes them first (`escapeHtml`).
 */
export function sigBlock(s) {
  const awaiting = s.state === 'wet' || s.state === 'awaiting';
  let plateContent = '';
  if (!awaiting) {
    plateContent = s.signatureBase64
      ? '<img src="' + s.signatureBase64 + '" />'
      : '<div class="printed-name">' + s.who + '</div>';
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

/** Escapes text for HTML element content and double-quoted attributes. `formHTML` and `sigBlock` concatenate strings without escaping, so anything typed or read from Odoo goes through this first. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
