/**
 * REMOVE-BEFORE-PROD (ADR 0028): example data for the Product status
 * prototype. Nothing here touches a database.
 */
import { STATUS } from "./lineState";

export const PROJECT = {
  sor: "SOR-901",
  client: "Sample City Government",
  s0: "S09901",
  request: "PR_0042",
};

// A small flat picture standing in for a photo somebody attached.
export function photoSrc(label, hue = 210) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="hsl(${hue} 45% 88%)"/>` +
    `<circle cx="30" cy="34" r="9" fill="hsl(${hue} 45% 70%)"/>` +
    `<path d="M0 82 L34 52 L56 70 L72 56 L96 78 V96 H0 Z" fill="hsl(${hue} 40% 62%)"/>` +
    `<text x="48" y="20" font-size="9" text-anchor="middle" fill="hsl(${hue} 40% 30%)" font-family="sans-serif">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Lines that come from the S0 (S09901), then the ones asked for in words. */
export const INITIAL_LINES = [
  {
    id: "s1",
    section: "sor",
    name: "Greenspirit 2 Cutter SC",
    code: "10GPT00030",
    qty: 1,
    free: 0,
    status: STATUS.PURCHASED,
    p0: { number: "P09683", state: "Confirmed", product: "Greenspirit 2 Cutter SC", price: 26400, eta: "30 Oct", received: 0, of: 1 },
    canvass: { code: "CNV_0007", offers: 3, of: 3, winnerPrice: 25000 },
  },
  { id: "s2", section: "sor", name: "Milwaukee Battery 18V", code: "M18", qty: 4, free: 6, status: STATUS.AVAILABLE, recheckFree: 1 },
  {
    id: "s3",
    section: "sor",
    name: "Milwaukee Charger M18",
    code: "M18C",
    qty: 2,
    free: 1,
    status: STATUS.TO_PURCHASE,
    p0: { number: "P09718", state: "RFQ", product: "Milwaukee Charger M18", price: 6800, eta: null, received: 0, of: 2 },
  },
  {
    id: "s4",
    section: "sor",
    name: "STIHL Professional Pole Pruner",
    code: "HT 75",
    qty: 1,
    free: 0,
    status: STATUS.CANVASSING,
    canvass: { code: "CNV_0009", offers: 2, of: 3 },
  },
  {
    id: "s5",
    section: "sor",
    name: "Rescue Buoy Life Ring",
    code: "RBLR-1",
    qty: 6,
    free: 0,
    status: STATUS.PURCHASED,
    p0: { number: "P09691", state: "Confirmed", product: "Rescue Buoy Life Ring", price: 3150, eta: "2 Nov", received: 3, of: 6 },
    canvass: { code: "CNV_0006", offers: 3, of: 3, winnerPrice: 3150 },
  },
  { id: "s6", section: "sor", name: "Rescue Tube", code: "NBR-02", qty: 6, free: 12, status: STATUS.NOT_CHECKED },
  {
    id: "s7",
    section: "sor",
    name: "E01 V2.0 Headlamp, 100 lumens",
    code: "E01.11117",
    qty: 10,
    free: 0,
    status: STATUS.RECEIVED,
    removedFromSor: true,
    p0: { number: "P09677", state: "Confirmed", product: "E01 V2.0 Headlamp, 100 lumens", price: 890, eta: null, received: 10, of: 10 },
  },
  {
    id: "s8",
    section: "sor",
    name: "Plastic Rescue Boat 60 hp, 15 passengers",
    code: "RB60-15",
    qty: 1,
    free: 0,
    status: STATUS.NOT_CHECKED,
    newOnS0: true,
    matchesRequest: "o1",
  },
  {
    id: "o1",
    section: "other",
    name: "Plastic boat, 60 hp, for 15 passengers",
    qty: 1,
    photo: photoSrc("boat", 200),
    forWhat: "For the client",
    askedBy: "Sales",
    when: "2 days ago",
    status: STATUS.PURCHASED,
    p0: { number: "P09731", state: "Confirmed", product: "Plastic Rescue Boat 60 hp, 15 passengers", price: 412000, eta: "4 Nov", received: 0, of: 1 },
  },
  {
    id: "o2",
    section: "other",
    name: "Glow sticks, 6 inch, lasts 48 hours",
    qty: 300,
    photo: photoSrc("glow", 120),
    forWhat: "For the client",
    askedBy: "Sales",
    when: "yesterday",
    status: STATUS.CANVASSING,
    canvass: { code: "CNV_0010", offers: 1, of: 3 },
  },
  {
    id: "o3",
    section: "other",
    name: "3/4 marine plywood",
    qty: 10,
    forWhat: "Material for the job",
    askedBy: "Purchasing",
    addedByPurchasing: true,
    when: "3 days ago",
    status: STATUS.PURCHASED,
    p0: { number: "P09682", state: "Confirmed", product: "Marine Plywood 3/4 in x 4 x 8 ft", price: 2150, eta: null, received: 0, of: 10 },
  },
  {
    id: "o4",
    section: "other",
    name: "Stikwell glue",
    qty: 4,
    forWhat: "Material for the job",
    askedBy: "Purchasing",
    when: "3 days ago",
    status: STATUS.RECEIVED,
    p0: { number: "P09682", state: "Confirmed", product: "Stikwell Marine Glue 250 ml", price: 340, eta: null, received: 4, of: 4 },
  },
];

/** P0s in Odoo. `source` is the P0's Source Document; `forId` is the line it is the same product as. */
export const ODOO_P0S = [
  { number: "P09744", state: "Confirmed", source: "S09901", product: "STIHL Professional Pole Pruner", code: "HT 75", qty: 1, price: 26400, eta: "6 Nov", forId: "s4" },
  { number: "P09746", state: "RFQ", source: "S09901", product: "STIHL Professional Pole Pruner", code: "HT 75", qty: 1, price: 25000, eta: null, forId: "s4" },
  { number: "P09735", state: "Confirmed", source: "S09901", product: "Milwaukee Charger M18", code: "M18C", qty: 2, price: 6800, eta: "2 Nov", forId: "s3" },
  { number: "P09738", state: "Confirmed", source: "S09901", product: "Rescue Tube", code: "NBR-02", qty: 6, price: 1450, eta: null, forId: "s6" },
  { number: "P09749", state: "RFQ", source: "S09901", product: "Plastic Rescue Boat 60 hp, 15 passengers", code: "RB60-15", qty: 1, price: 405000, eta: null, forId: "s8" },
  { number: "P09752", state: "RFQ", source: "PR_0042", product: "Glow Stick 6 in, 48 hours", code: null, qty: 300, price: 14, eta: null, forId: "o2" },
  { number: "P09753", state: "Confirmed", source: "PR_0042", product: "Glow Stick 6 in, 48 hours", code: null, qty: 300, price: 15, eta: "8 Nov", forId: "o2" },
  { number: "P09728", state: "Confirmed", source: "S09901", product: "Safety Vest, Orange, Reflective", code: "SV-OR", qty: 20, price: 520, eta: "3 Nov", forId: null },
  { number: "P09733", state: "RFQ", source: "S09901", product: "Whistle, Fox 40", code: "FOX40", qty: 30, price: 180, eta: null, forId: null },
  { number: "P09741", state: "Confirmed", source: "S09901", product: "Throw Bag, 15 m rope", code: "TB-15", qty: 6, price: 1950, eta: "5 Nov", forId: null },
  { number: "P09760", state: "Confirmed", source: "PR_0042", product: "Rope, 12 mm, 100 m", code: "RP-12", qty: 2, price: 3200, eta: "4 Nov", forId: null },
];

/** Products Purchasing can pick as a replacement. */
export const REPLACEMENT_PRODUCTS = [
  { value: "HT 133", name: "STIHL Telescopic Pole Pruner", code: "HT 133" },
  { value: "M18DC", name: "Milwaukee Dual Bay Charger M18", code: "M18DC" },
  { value: "NBR-03", name: "Rescue Tube, Heavy Duty", code: "NBR-03" },
  { value: "RB60-12", name: "Plastic Rescue Boat 60 hp, 12 passengers", code: "RB60-12" },
];

export const INITIAL_DIRECT_REQUESTS = [
  { id: "d1", title: "Demo unit for the client's test day", pr: "PR_0057", p0: "P09666", status: STATUS.RECEIVED, project: PROJECT.sor },
  { id: "d2", title: "Van rental for the site visit", pr: "PR_0061", p0: "P09701", status: STATUS.PURCHASED, project: PROJECT.sor },
  { id: "d3", title: "Booth banner for the presentation", pr: "PR_0063", p0: null, status: STATUS.NOT_CHECKED, project: PROJECT.sor },
];

export const FIRST_NEW_REQUEST_NUMBER = 64;
export const FIRST_NEW_CANVASS_NUMBER = 12;

export const VIEWS = [
  { key: "project", label: "1 · Project Purchase Request" },
  { key: "direct", label: "2 · Direct request for a project" },
  { key: "sor", label: "3 · SOR: Direct requests for this project" },
];
