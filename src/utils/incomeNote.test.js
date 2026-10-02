import { describe, it, expect } from "vitest";
import { parseIncomeNote } from "../../supabase/functions/_shared/incomeNote.ts";

const NONE = { marketplaceOrderId: null, marketplaceFee: null, orderIncome: null };

describe("parseIncomeNote", () => {
  const cases = [
    {
      name: "Shopee template with fee + income",
      note: "<p>NAME: Juan Dela Cruz</p><p>DATE OF PAYMENT: 09/02/2026</p><p>ORDER ID: 2609020BTB5E8F</p><p>FEE: 123.45</p><p>ORDER INCOME: 1,376.55</p>",
      amount: 1500,
      want: { marketplaceOrderId: "2609020BTB5E8F", marketplaceFee: 123.45, orderIncome: 1376.55 },
    },
    {
      name: "Lazada flat template",
      note: "NAME: Ana\nDATE: 09/02/2026\nORDER ID: 876543210\nFEE: 100\nOI: 900",
      amount: 1000,
      want: { marketplaceOrderId: "876543210", marketplaceFee: 100, orderIncome: 900 },
    },
    {
      name: "CLIENT DETAILS template with &amp;nbsp; glued labels",
      note: "<p>CLIENT DETAILS:</p><p>NAME:&amp;nbsp;Ana</p><p>ORDER&amp;nbsp;ID:&amp;nbsp;ABC123</p><p>FEE:&amp;nbsp;50</p><p>ORDER&amp;nbsp;INCOME:&amp;nbsp;450</p>",
      amount: 500,
      want: { marketplaceOrderId: "ABC123", marketplaceFee: 50, orderIncome: 450 },
    },
    {
      name: "&nbsp; entities decode",
      note: "<p>ORDER&nbsp;ID:&nbsp;ZZ9</p><p>OI:&nbsp;10</p>",
      amount: 10,
      want: { marketplaceOrderId: "ZZ9", marketplaceFee: null, orderIncome: 10 },
    },
    {
      name: "DATE: variant, no colon after labels, lowercase",
      note: "date: 1/2/26\norder id 555\nfee 10\norder income 90",
      amount: 100,
      want: { marketplaceOrderId: "555", marketplaceFee: 10, orderIncome: 90 },
    },
    {
      name: "prefixed SHOPEE AND LAZADA ORDER ID",
      note: "SHOPEE AND LAZADA ORDER ID: 24680\nOI: 5",
      amount: 5,
      want: { marketplaceOrderId: "24680", marketplaceFee: null, orderIncome: 5 },
    },
    {
      name: "adjacent <pre> blocks with a blank date",
      note: '<pre><span><strong>ORDER ID:</strong> 2606252JTF8JDP</span></pre><pre><span>DATE OF PAYMENT: </span></pre><pre><span><strong>FEE: </strong>697.42</span></pre><pre><span>ORDER INCOME: 2,182.58</span></pre>',
      amount: 2880,
      want: { marketplaceOrderId: "2606252JTF8JDP", marketplaceFee: 697.42, orderIncome: 2182.58 },
    },
    {
      name: "older single-line template, labels run together",
      note: "Order ID 240515CHECCHU6,Arlyn,Bacolod City Fee: ₱2,572 Order Income: ₱11,903.00 PAID 5/19/24 Buyer Payment: ₱14,913",
      amount: 14475,
      want: { marketplaceOrderId: "240515CHECCHU6", marketplaceFee: 2572, orderIncome: 11903 },
    },
    {
      name: "peso sign after the label",
      note: "Order ID 240307E3KQY8V3,Genevieve Fee: ₱448 Order Income ₱:2,317 PAID 3/9/24",
      amount: 2765,
      want: { marketplaceOrderId: "240307E3KQY8V3", marketplaceFee: 448, orderIncome: 2317 },
    },
    {
      name: "comma decimal is not a number",
      note: "Order ID 2402095C7RHVQE,Jhone Fee: 20,00 Order Income: 95,00 PAID 2/18/24",
      amount: 115,
      want: { marketplaceOrderId: "2402095C7RHVQE", marketplaceFee: null, orderIncome: null },
    },
    {
      name: "order id with no digit is a misplaced place name",
      note: "ORDER ID: Bulacan\nNAME: Nino\nORDER INCOME: 50",
      amount: 50,
      want: { marketplaceOrderId: null, marketplaceFee: null, orderIncome: 50 },
    },
    {
      name: "income without fee",
      note: "ORDER INCOME: 700",
      amount: 800,
      want: { marketplaceOrderId: null, marketplaceFee: null, orderIncome: 700 },
    },
    {
      name: "fee without income",
      note: "ORDER ID: X1\nFEE: 70",
      amount: 800,
      want: { marketplaceOrderId: "X1", marketplaceFee: 70, orderIncome: null },
    },
    {
      name: "TOTAL BUYER AMOUNT reconciles, so it is income",
      note: "ORDER ID: X2\nFEE: 100\nTOTAL BUYER AMOUNT: 900",
      amount: 1000,
      want: { marketplaceOrderId: "X2", marketplaceFee: 100, orderIncome: 900 },
    },
    {
      name: "TOTAL BUYER AMOUNT within 0.05",
      note: "FEE: 100\nTOTAL BUYER AMOUNT: 899.97",
      amount: 1000,
      want: { marketplaceOrderId: null, marketplaceFee: 100, orderIncome: 899.97 },
    },
    {
      name: "TOTAL BUYER AMOUNT that does not reconcile stays null",
      note: "FEE: 100\nTOTAL BUYER AMOUNT: 850",
      amount: 1000,
      want: { marketplaceOrderId: null, marketplaceFee: 100, orderIncome: null },
    },
    {
      name: "TOTAL BUYER AMOUNT without a fee is not trusted",
      note: "TOTAL BUYER AMOUNT: 1000",
      amount: 1000,
      want: NONE,
    },
    {
      name: "typed income beats TOTAL BUYER AMOUNT",
      note: "FEE: 100\nOI: 880\nTOTAL BUYER AMOUNT: 900",
      amount: 1000,
      want: { marketplaceOrderId: null, marketplaceFee: 100, orderIncome: 880 },
    },
    {
      name: "blank labels give null",
      note: "<p>ORDER ID:</p><p>FEE:</p><p>ORDER INCOME: </p>",
      amount: 100,
      want: NONE,
    },
    {
      name: "comma thousands and peso sign",
      note: "FEE: ₱1,234.50\nORDER INCOME: PHP 12,345.6",
      amount: 14000,
      want: { marketplaceOrderId: null, marketplaceFee: 1234.5, orderIncome: 12345.6 },
    },
    {
      name: "non-numeric is null, never a partial parse",
      note: "FEE: 12abc\nORDER INCOME: n/a",
      amount: 100,
      want: NONE,
    },
    {
      name: "more than two decimals is null",
      note: "ORDER INCOME: 10.123",
      amount: 100,
      want: NONE,
    },
    {
      name: "a note with none of the labels",
      note: "<p>Called the buyer, will ship tomorrow.</p>",
      amount: 100,
      want: NONE,
    },
    {
      name: "a pasted screenshot beside the typed figures is ignored",
      note: `<p>ORDER ID: ABC123</p><p><img src="data:image/png;base64,${"iVBORw0KGgo".repeat(5000)}" style="width: 100%;"></p><p>FEE: 50</p><p>OI: 450</p>`,
      amount: 500,
      want: { marketplaceOrderId: "ABC123", marketplaceFee: 50, orderIncome: 450 },
    },
    { name: "empty note", note: "", amount: 100, want: NONE },
  ];

  it.each(cases)("$name", ({ note, amount, want }) => {
    expect(parseIncomeNote(note, amount)).toEqual(want);
  });
});
