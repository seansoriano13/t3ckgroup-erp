import { Link } from "react-router";
import { ExternalLink } from "@/components/ui/external-link";

const LINK_CLASS = "font-medium underline underline-offset-2";

/**
 * #855: an attach message that names an IPAS, with the IPAS number as a link to its page in the app
 * (`/purchasing/ipas/:id`, never Odoo). With no id or number, or when the number is not in the text, the
 * message stays plain text. `plainAnchor` is for toasts, which render outside the router: a Link there would throw, so it opens the page in a new tab.
 */
export default function IpasMessage({ message, ipasId, ipasNumber, plainAnchor = false }) {
  if (!message || !ipasId || !ipasNumber) return message ?? null;
  const at = message.indexOf(ipasNumber);
  if (at < 0) return message;
  const to = `/purchasing/ipas/${ipasId}`;
  const link = plainAnchor ? (
    <ExternalLink href={to} className={LINK_CLASS}>{ipasNumber}</ExternalLink>
  ) : (
    <Link to={to} className={LINK_CLASS}>{ipasNumber}</Link>
  );
  return (
    <>
      {message.slice(0, at)}
      {link}
      {message.slice(at + ipasNumber.length)}
    </>
  );
}
