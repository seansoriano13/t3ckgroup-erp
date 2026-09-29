-- Stage colors follow the deal's journey instead of whoever picked last.
-- One rule, read left to right like the flow itself:
--
--   Pursue    blues    — still cold, still chasing       Lead sky, Qualified blue
--   Compete   purples  — up against others, heating up   Proposal indigo, For Bidding violet,
--                                                        Bid Submitted plum, Post Qualification pink,
--                                                        Negotiation crimson
--   Award     golds    — it's ours; contract paperwork   Awarded / NOA amber, Performance Bond orange,
--                                                        NTP yellow, CA / PO + PO Received gold
--   Fulfil    teals    — doing the work                  PMS Sourcing cyan, Delivery teal
--   Cash      greens   — money in, deal done             Payment Verification lime, Collection jade,
--                                                        Closed Won green
--   Beyond                                               Retention brown (the long, steady relationship),
--                                                        SO Evaluation mauve (internal housekeeping),
--                                                        Closed Lost tomato
--
-- Same Stage name = same color in every Sales Flow, so a color learned on one
-- Sale Type means the same thing on the next. Matched by name; a Stage whose
-- name fits none of these keeps what it has. Published Flow Snapshots are
-- frozen and are not touched.
update public.flow_stages s
set color = m.color
from (values
  ('^lead$',                              'sky'),
  ('^qualified$',                         'blue'),
  ('^proposal( submitted)?$',             'indigo'),
  ('^for bidding$',                       'violet'),
  ('^bid submitted$',                     'plum'),
  ('^(pq\M|post[- ]qualification)',       'pink'),
  ('^negotiation$',                       'crimson'),
  ('^(awarded$|noa\M|notice of award)',   'amber'),
  ('^(pb\M|performance bond)',            'orange'),
  ('^(ntp\M|notice to proceed)',          'yellow'),
  ('^(ca ?/ ?po$|po received$)',          'gold'),
  ('^so evaluation$',                     'mauve'),
  ('^pms sourcing',                       'cyan'),
  ('^(project )?delivery$',               'teal'),
  ('^payment verification$',              'lime'),
  ('^collection$',                        'jade'),
  ('^closed won$',                        'green'),
  ('^retention$',                         'brown'),
  ('^closed lost$',                       'tomato')
) as m(pattern, color)
where btrim(s.name) ~* m.pattern
  and s.color is distinct from m.color;
