# Philippine government procurement — reference glossary

Verbatim acronym list supplied 2026-08-25, from the Tagbilaran City bid
documents (IB No. 2603-211, Rescue Truck). These are **Philippine Bidding
Documents, First Edition May 2025, issued under RA No. 12009** — the current
procurement law, which replaced RA 9184.

This file is reference material, not design vocabulary. The handful of terms
the system actually models live in `CONTEXT.md`; everything here exists so a
bid document can be read without a second tab open.

| | |
| --- | --- |
| **ABC** | Approved Budget for the Contract |
| **BAC** | Bids and Awards Committee |
| **BDS** | Bid Data Sheet |
| **BIR** | Bureau of Internal Revenue |
| **BSP** | Bangko Sentral ng Pilipinas |
| **CDA** | Cooperative Development Authority |
| **CIF** | Cost Insurance and Freight |
| **CIP** | Carriage and Insurance Paid |
| **COS** | Contract of Service |
| **CPI** | Consumer Price Index |
| **DDP** | Delivered Duty Paid |
| **DOLE** | Department of Labor and Employment |
| **DTI** | Department of Trade and Industry |
| **EXW** | Ex Works |
| **FCA** | Free Carrier (shipping point) |
| **FOB** | Free on Board (shipping point) |
| **GCC** | General Conditions of Contract |
| **GFI** | Government Financial Institution |
| **GOCC** | Government-Owned and/or -Controlled Corporation |
| **GoP** | Government of the Philippines |
| **GPPB** | Government Procurement Policy Board |
| **HoPE** | Head of Procuring Entity |
| **INCOTERMS** | International Commercial Terms |
| **IRR** | Implementing Rules and Regulations |
| **ITB** | Instructions to Bidders |
| **JO** | Job Order |
| **LCB** | Lowest Calculated Bid |
| **LCRB** | Lowest Calculated Responsive Bid |
| **LGU** | Local Government Unit |
| **LoC** | Letter of Credit |
| **MAB** | Most Advantageous Bid |
| **MARB** | Most Advantageous Responsive Bid |
| **MEARB** | Most Economically Advantageous Responsive Bid |
| **MYCA** | Multi-Year Contracting Authority |
| **NFCC** | Net Financial Contracting Capacity |
| **NGA** | National Government Agency |
| **PhilGEPS** | Philippine Government Electronic Procurement System |
| **PSA** | Philippine Statistics Authority |
| **RA No.** | Republic Act Number |
| **SARB** | Single Advantageous Responsive Bid |
| **SCC** | Special Conditions of Contract |
| **SCRB** | Single Calculated Responsive Bid |
| **SEARB** | Single Economically Advantageous Responsive Bid |
| **SEC** | Securities and Exchange Commission |
| **SLCC** | Single Largest Completed Contract |
| **UN** | United Nations |

> **Note on ITB.** In this list `ITB` means *Instructions to Bidders* — a
> section of the bidding documents. The system's retired `itb_number` field
> meant *Invitation to Bid*, a different thing. The collision is one more
> reason D12 removes it rather than renaming it.

---

## Clauses this project depends on

Read from the bid document itself, with page references. These are the numbers
behind three pipeline stages and two OPEX lines.

### Ten calendar days from Notice of Award — ITB 29.3, 30.1 (p. 39)

> "Within **ten (10) calendar days** from receipt by the winning Bidder of the
> Notice of Award, the following conditions should be complied with before the
> contract may be awarded: … Posting of the performance security … and Signing
> of the contract."

So `Notice of Award → Performance Bond → Contract Agreement` is not a loose
sequence — it is a **statutory 10-day clock**, and blowing it forfeits the
award. Receipt of the NOA must also be **confirmed in writing within two (2)
days** (ITB 29.2).

### Performance Security — ITB 31.3 (p. 40)

A percentage of the **total contract price**, by instrument:

| Form | Not less than |
| --- | --- |
| Cash, cashier's or manager's check | **5%** |
| Bank draft / guarantee / irrevocable LC, or surety bond | **30%** |

### Retention money — GCC 17.3–17.4 (p. 54)

> "Retention money in an amount equivalent to **at least one percent (1%) but
> not to exceed five percent (5%) of every progress payment**"

Released only **after the warranty period lapses**. This resolves C10: the
OPEX sheet's "1% Retention" is *warranty retention*, it is taken **per progress
payment** rather than once, and the `Retention` stage is the deal waiting out
the warranty period.

### Liquidated Damages — GCC 19.1–19.3 (p. 55)

Deducted **per day of delay** until the goods are delivered and accepted. The
procuring entity need not prove actual damages. **At 10% of the total contract
price the client may rescind the contract.** This resolves C11 — LD has a
formula, a ceiling, and a consequence.

### ⚠️ Quantity cannot change at award — ITB 29.4 (p. 39)

> "At the time of contract award, the Procuring Entity shall **not increase or
> decrease the quantity of goods** originally specified in Section VI. Schedule
> of Requirements."

This contradicts the premise behind Q49. See §3f of the redesign doc.

### Post-qualification — ITB 27.2–27.7 (p. 37)

Non-discretionary **pass/fail**, completed within **twelve (12) calendar
days**. Failing it disqualifies the bidder and can forfeit the Bid Security;
the BAC then repeats the process on the next-ranked bidder. So a deal sitting
in `Post-Qualification` has a 12-day clock and two outcomes only.
