# PR · Purchase Requests and Requested Items

Guide §6. Project requests are opened by a Stage Action (FLOW-01). Where a story needs a Project request, it uses the seed's request on S990001 or S990002, or one FLOW-01 made.

A request opens in the record window over `/purchasing` at every width, phones included (the window fills the screen). Its title is the number and name, with one state badge. The Buyer, SOR, Stage and Items are pills under the title. Members and Chat are two buttons that open a side panel inside the window. The window has no footer and no Expand. It has no More menu.

### PR-01 · Any employee opens a Direct request
- **Guide**: §6 The request
- **Log in as**: plain, then purchaser
- **Steps**:
  1. As plain, New Direct request "STORY PR-01".
  2. Try to add an item from an SOR line.
  3. Add a new-product item "STORY PR-01 Stapler", 2 pc.
  4. As purchaser, open the request.
- **You should see**:
  - The kind shows Direct and the project shows "Direct request".
  - Step 2 is not offered (Direct allows only new products).
  - purchaser is a member already (every Purchasing holder joins a Direct request).
  - There is no Approve control anywhere. Nobody approves a request.

### PR-02 · Nobody is told about their own action
- **Guide**: §6 Who is notified
- **Log in as**: plain, then purchaser, then purchaser-2
- **Needs**: PR-01
- **Steps**:
  1. As plain, check notifications.
  2. As purchaser and purchaser-2, check notifications.
- **You should see**: plain got no notice for opening it. Both purchasers got one "request opened, no Buyer" notice each.

### PR-03 · Take a request, and the refusal when someone has it
- **Guide**: §6 The request
- **Log in as**: purchaser, then purchaser-2 (two tabs if possible)
- **Needs**: an unassigned request (PR-01 works)
- **Steps**:
  1. As purchaser-2, open the request (it opens in the record window) and keep the window open.
  2. As purchaser, press the outline Take button beside the Buyer pill.
  3. As purchaser-2, without reloading, press Take.
- **You should see**: step 2 makes purchaser the Buyer. Step 3 is refused with a message that someone else has it. Nobody gets a "Buyer set" notice for step 2, because purchaser set it themselves.

### PR-04 · Name and clear the Buyer
- **Guide**: §6 The request
- **Log in as**: purchaser, then purchaser-2
- **Needs**: PR-03
- **Steps**:
  1. As purchaser, click the Buyer pill and pick purchaser-2.
  2. As purchaser-2, check notifications.
  3. As purchaser-2, try to remove purchaser-2 from the members (Members button).
  4. As purchaser-2, clear the Buyer (Buyer pill).
- **You should see**: purchaser-2 gets a "Buyer set" notice. Step 3 is refused (the Buyer cannot be removed). After step 4 the request shows under the Buyer dropdown's Unassigned choice again.

### PR-05 · Unassigned Project request is seen by every purchaser
- **Guide**: §6 The request
- **Log in as**: purchaser-2
- **Steps**:
  1. Open `/purchasing`, set the Buyer dropdown to Unassigned.
- **You should see**: the seed request on S990002 (it has no Buyer) is listed, even though purchaser-2 is not a member.

### PR-06 · Sales side cannot manage members
- **Guide**: §6 The request
- **Log in as**: sales-exec
- **Needs**: a Project request on an SOR where sales-exec is a member
- **Steps**:
  1. Open the request, then its Members button. Try to add sales-exec-2 as a member. Try to remove someone.
- **You should see**: no control, or a refusal. Only purchasing members and Super Admins manage members.

### PR-07 · Chat is append-only and mentions are members only
- **Guide**: §6 The request
- **Log in as**: purchaser
- **Needs**: a request where purchaser is Buyer
- **Steps**:
  1. Open the request's Chat button. Post "STORY PR-07 hello".
  2. Look for edit or delete on that message.
  3. Type `@` and look at who can be mentioned.
  4. Mention a member.
- **You should see**:
  - No edit or delete, even on your own message.
  - Only members are offered for mention.
  - The mentioned person gets a mention notice instead of the ordinary message notice.
  - System messages (status changes, member changes) show as system, not as a person.

### PR-08 · Plain messages, once a Buyer exists, go only to the Buyer and requesters
- **Guide**: §6 Who is notified
- **Log in as**: sales-exec (a requester), then purchaser (Buyer), then another member who is neither
- **Steps**:
  1. As sales-exec, post a plain message.
  2. Check notifications for purchaser and for the other member.
- **You should see**: purchaser is told. The other member is not.

### PR-09 · Add an item from an SOR line, with a snapshot
- **Guide**: §6 Where an item comes from
- **Log in as**: sales-exec, then sales-exec (after editing the SOR)
- **Needs**: a Project request on an SOR with Product List lines where sales-exec is Deal Team
- **Steps**:
  1. Add an item by picking an SOR line. Note name, quantity, unit and Odoo product.
  2. Change that line's quantity on the SOR.
  3. Reopen the request.
- **You should see**: the item keeps the old quantity. The view says "SOR line now says N" with the new number. The Buyer gets an "item added" notice.

### PR-10 · Stock badge always has a time
- **Guide**: §6 Where an item comes from
- **Log in as**: purchaser
- **Steps**:
  1. Look at the stock badge on an item from an SOR line, on an SOR whose stock was never fetched.
  2. Refresh the SOR's stock (on the SOR). Look again.
- **You should see**: "Not checked" first. After the refresh, a figure with the time it was fetched. Nothing says "live".

### PR-11 · Who may add items
- **Guide**: §6 Who can add Requested Items
- **Log in as**: sales-exec (Deal Team), sales-exec-2 (not Deal Team, not requester), purchaser (Buyer), plain (opener of a Direct request)
- **Steps**:
  1. Each person tries to add a new-product item "STORY PR-11 <key>" to the right request.
- **You should see**: sales-exec, purchaser and plain (on their own Direct request) can. sales-exec-2 cannot.

### PR-12 · Add from Components is Purchasing only, all or nothing
- **Guide**: §6 Where an item comes from
- **Log in as**: purchaser, then sales-exec
- **Needs**: CM-02 (a matrix with Components on the same SOR as the request)
- **Steps**:
  1. As sales-exec, look for "Add from Components".
  2. As purchaser, add two Components as items.
  3. Rename one of those Components on the matrix.
- **You should see**: sales-exec has no such control. purchaser's two items appear with each Component's name, quantity, unit and Odoo product. After step 3 the item keeps the old name.

### PR-13 · Item status path, happy path
- **Guide**: §6 The item status path
- **Log in as**: purchaser (Buyer)
- **Steps**:
  1. Move an item Requested → To order → Canvassing → Ordered (no PO number) → Received.
  2. After each move, note the status.
  3. Try to move the Received item anywhere.
- **You should see**: each move works. Ordered without a PO saves. Received offers no further move. The requester gets a notice at each change.

### PR-14 · Skips, ways out, and "no undo"
- **Guide**: §6 The item status path
- **Log in as**: purchaser
- **Steps**:
  1. Move an item To order → Ordered (skipping Canvassing).
  2. Move another item Requested → From stock.
  3. Move a third item to Cannot source. Then try to move it back.
  4. Try Requested → Received directly.
- **You should see**: steps 1 to 3 work. Closed items go nowhere. Step 4 is not offered.

### PR-15 · Sales side can only cancel
- **Guide**: §6 The item status path
- **Log in as**: sales-exec
- **Steps**:
  1. On an open item, look at the status choices.
  2. Cancel it.
- **You should see**: Cancel is the only choice. It works.

### PR-16 · A non-Purchasing Buyer can only cancel
- **Guide**: §6 The item status path
- **Log in as**: super-admin (to name the Buyer), then sales-exec
- **Steps**:
  1. As super-admin, name sales-exec as Buyer of a Project request.
  2. As sales-exec, look at an item's status choices.
- **You should see**: only Cancel.

### PR-17 · Ordered with a PO number
- **Guide**: §6 Edge cases
- **Log in as**: purchaser
- **Steps**:
  1. Set an item to Ordered with ` p02401 ` (spaces, lower case).
  2. On another item, try `ABC123`.
  3. On another item, try `P9999999`.
- **You should see**:
  - Step 1 saves as `P02401` (trimmed, upper case) after the server checked it with Odoo, and reads "Confirmed in Odoo".
  - Step 2 is refused as the wrong shape.
  - Step 3 is refused and says Odoo has no such PO, naming it. Nothing is saved. It must not say "could not check".
  - A direct call that sends its own "verified" mark is refused; the mark only comes from the server.

### PR-18 · "Could not check" when Odoo is down
- **Guide**: §6, §15
- **Log in as**: purchaser
- **Steps**:
  1. Stop the functions server (ask the human, or note BLOCKED if you cannot).
  2. Set an item to Ordered with `P02396`.
  3. Start the functions server again.
- **You should see**: the PO is saved as "Not checked — Odoo did not answer", with a warning on screen. The message says Odoo could not be checked. It must not say the PO does not exist, and it is not refused.

### PR-18b · Correct PO on an Ordered item
- **Guide**: §6 The item status path
- **Log in as**: purchaser, then sales-exec
- **Needs**: an item Ordered with a wrong PO (for example `P02396`) and, if possible, a picked line
- **Steps**:
  1. As purchaser, choose Correct PO on the Ordered item and enter `P02401`.
  2. Try Correct PO with `P9999999`.
  3. Read the item's history. Look at any picked PO lines.
  4. Move the item to Received. Look for Correct PO.
  5. As sales-exec, look for Correct PO on an Ordered item.
- **You should see**: step 1 saves, checked against Odoo again ("Confirmed in Odoo"). Step 2 is refused, naming the PO. Step 3: the history has both the old and the new PO number, and the lines picked on the old PO are cleared. Step 4: no Correct PO once Received. Step 5: only Purchasing can correct. An Ordered item with no PO can also get its first PO this way.

### PR-19 · Pick PO lines, and "PO line not picked"
- **Guide**: §6 Edge cases
- **Log in as**: purchaser
- **Needs**: IPAS-01 (a live IPAS for P02401)
- **Steps**:
  1. Set an item to Ordered with `P02401` and pick no line.
  2. Set another item to Ordered with `P02401` and pick one line.
- **You should see**: item 1 reads "PO line not picked". Item 2 shows the picked line. Only lines from P02401's IPAS copy are offered.

### PR-20 · Substitute an item
- **Guide**: §6 Where an item comes from
- **Log in as**: purchaser (Buyer)
- **Steps**:
  1. On an open item, add a substitute "STORY PR-20 replacement".
- **You should see**: a new item linked to the old one. The old one is Substituted and closed.

### PR-21 · Opening a Canvass moves To order to Canvassing, and nothing else
- **Guide**: §6 Edge cases, §8
- **Log in as**: purchaser
- **Steps**:
  1. Open a Canvass on a bare item at To order.
  2. Open a Canvass on a bare item at Requested.
- **You should see**: item 1 moves to Canvassing. Item 2 stays at Requested.

### PR-22 · Status changes take no details except Ordered
- **Guide**: §6 Edge cases
- **Log in as**: purchaser
- **Steps**:
  1. Move an item to To order, Canvassing, Cannot source, From stock in turn (different items).
- **You should see**: none of these asks for a PO number or any other detail.

### PR-23 · Lost or deleted SOR label
- **Guide**: §5, §17 (could not confirm whether writes are blocked)
- **Log in as**: sales-exec, then purchaser
- **Steps**:
  1. Register a fresh SOR "Mock Client Story PR-23" and get a Project request on it (FLOW-01).
  2. Mark the SOR as Lost.
  3. As purchaser, open the request. Try to add an item and change a status.
- **You should see**: the request shows "SOR lost". **Write down** whether the add and the status change were allowed. This is an open question in the guide, so either answer is a PASS; the note is what matters.
