# PKL · Packing Lists

Guide §11. No Stage Action makes Packing Lists yet (§17), so they are made by hand.

### PKL-01 · Who can make one
- **Guide**: §11
- **Log in as**: purchaser, plain (Warehouse), sales-exec
- **Steps**:
  1. Each person tries to make a Packing List for S990003.
- **You should see**: purchaser and plain can. sales-exec cannot. The number looks like `PKL_` plus three digits.

### PKL-02 · Boxes come from the Product List, without prices
- **Guide**: §11
- **Log in as**: plain
- **Steps**:
  1. Pick the SOR. Read the picker.
  2. Add box 1 with two Product List lines. Add box 2, empty.
- **You should see**: the picker shows reference, project title and stage only. Lines show name, quantity and unit, never prices.

### PKL-03 · Pack needs contents in every box
- **Guide**: §11
- **Log in as**: plain
- **Steps**:
  1. Pack with box 2 empty → refused.
  2. Delete box 2 or fill it. Type an Odoo delivery ref. Pack.
- **You should see**: step 2 works.

### PKL-04 · Packed is frozen
- **Guide**: §11
- **Log in as**: plain, then purchaser, then super-admin
- **Steps**:
  1. Each person tries to edit a box, add a box, change contents.
- **You should see**: every change refused, super-admin included.

### PKL-05 · Who reads it
- **Guide**: §11
- **Log in as**: sales-exec (can read S990003), sales-exec-2 (cannot), finance
- **Steps**:
  1. Each opens the Packing List from the SOR or the list.
- **You should see**: sales-exec and finance can read it. sales-exec-2 cannot.

### PKL-06 · Cancel (open question)
- **Guide**: §17
- **Log in as**: purchaser
- **Steps**:
  1. Look for a way to cancel a draft and a packed list.
- **You should see**: write down what exists. Either answer is a PASS; the note is what matters.
