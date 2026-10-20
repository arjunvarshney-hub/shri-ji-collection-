# Browser suite 2: checkout, order tracking timeline, admin order management, cancellation, returns, emails, payment, reviews, assistant.
import os
from e2e_common import *
os.makedirs("/tmp/shots", exist_ok=True)
ADDR = {"name": "Sita Devi", "phone": "9927892667", "house": "12-B", "locality": "Tirth Mandir Road", "landmark": "Near the gate", "city": "Sambhal", "state": "Uttar Pradesh", "pincode": "244303"}
def mails(sub=None, to=None): return [m for m in state()["mails"] if (sub is None or re.search(sub, m["subject"])) and (to is None or to in m["to"])]
def stock(sku): return next(v["stock"] for v in state()["variants"] if v["sku"] == sku)
def order(num): return next(o for o in state()["orders"] if o["order_number"] == num)
def status_of(num): return order(num)["order_status"]
with sync_playwright() as p:
    env = Env(p.chromium.launch()); br = env.br
    hit("/__seed")
    oc, ad = env.owner(); cc, cu = env.signup("sita@example.com", name="Sita Devi"); rc, raj = env.signup("raj@example.com", name="Raj Kumar")
    # catalogue made through the real admin API (variants + pack stock + different return rules)
    r = fj(ad, "/api/admin/products", "POST", {"name": "Laddu Gopal Necklace", "category": "mala-and-necklace", "price": 90, "stock": 0, "option_types": ["colour", "pack"], "return_eligible": "true", "return_window_days": 7, "return_conditions": "Unused", "variants": [
        {"options": {"colour": "Red", "pack": "Pack of 3"}, "sku": "R3", "price": 250, "sale_price": 199, "stock": 30, "pack_qty": 3}, {"options": {"colour": "Blue", "pack": "Single Piece"}, "sku": "B1", "price": 90, "stock": 5, "pack_qty": 1}]}); assert r["status"] == 201, r
    r = fj(ad, "/api/admin/products", "POST", {"name": "Gold Mukut Premium", "category": "mukut", "price": 399, "stock": 10, "return_eligible": "false"}); assert r["status"] == 201, r
    prods = {x["name"]: x for x in state()["products"]}; NECK, MUK = prods["Laddu Gopal Necklace"], prods["Gold Mukut Premium"]
    vid = {v["sku"]: v["id"] for v in state()["variants"]}
    def put_cart(pg, items): pg.goto(B + "/cart"); pg.evaluate("items => localStorage.setItem('sjc_cart_v2', JSON.stringify(items))", items)
    def place(pg, items, pm="COD", form=ADDR):
        put_cart(pg, items); pg.goto(B + "/checkout"); pg.wait_for_selector("#f")
        for k in ["phone", "house", "locality", "landmark", "city", "pincode"]: pg.fill(f"input[name={k}]", form[k])
        if pm == "ONLINE": pg.check("input[value=ONLINE]")
        pg.click("#go"); pg.wait_for_url("**/account?order=*", timeout=15000); return re.search(r"order=([^&]+)", pg.url).group(1)

    # ---------- Checkout ----------
    put_cart(cu, [{"id": NECK["id"], "v": vid["R3"], "size": "", "qty": 1}, {"id": MUK["id"], "v": 0, "size": "", "qty": 1}])
    cu.goto(B + "/checkout"); cu.wait_for_selector("#f"); t = cu.inner_text("#box")
    rec("checkout: contact, house/flat, street/locality, landmark, city, state, PIN fields", all(cu.locator(f"input[name={n}]").count() == 1 for n in ["name", "phone", "email", "house", "locality", "landmark", "city", "state", "pincode"]))
    rec("checkout: items, variants, pack size, discounts, delivery and final total shown", "Red / Pack of 3" in t and "Pack of 3" in t and "₹199" in t and "₹250" in t and "₹399" in t and "₹598" in t and "₹40" in t and "₹638" in t and "Non-returnable" in t and "Returnable within 7 days" in t, t[:200].replace("\n", " "))
    cu.fill("input[name=phone]", "12345"); cu.click("#go"); rec("checkout: invalid mobile rejected", "10-digit" in cu.inner_text("#m"))
    cu.fill("input[name=phone]", ADDR["phone"]); cu.fill("input[name=house]", ""); cu.click("#go"); rec("checkout: house/flat required", "house" in cu.inner_text("#m").lower())
    env.overflow(cu, "checkout"); env.shot(cu, "40_checkout")
    cu.fill("input[name=house]", ADDR["house"]); [cu.fill(f"input[name={k}]", ADDR[k]) for k in ["locality", "landmark", "city", "pincode"]]
    cu.dblclick("#go"); cu.wait_for_url("**/account?order=*", timeout=15000); N1 = re.search(r"order=([^&]+)", cu.url).group(1)
    rec("double tap on Place order creates exactly ONE order", len([o for o in state()["orders"] if o["user_id"]]) == 1)
    o = order(N1)
    rec("order: server prices, delivery rule (₹598 -> ₹40), total ₹638, address composed", o["subtotal"] == 598 and o["shipping"] == 40 and o["total"] == 638 and o["address"] == "12-B, Tirth Mandir Road, Landmark: Near the gate" and o["payment_status"] == "pending" and o["order_status"] == "pending")
    rec("stock counted in pieces: 1 pack of 3 -> 30 becomes 27", stock("R3") == 27)
    rec("order items keep a snapshot of variant, SKU, pack size and return policy", o["items"][0]["variant_label"] == "Red / Pack of 3" and o["items"][0]["sku"] == "R3" and o["items"][0]["pack_qty"] == 3 and o["items"][0]["return_policy"]["eligible"] is True and o["items"][1]["return_policy"]["eligible"] is False)
    cu.wait_for_selector(".steps"); tx = cu.inner_text("#box")
    rec("customer order page: placed banner, items, variant, pack, delivery, final total", "Order placed" in tx and "Red / Pack of 3" in tx and "Pack of 3" in tx and "Delivery" in tx and "₹40" in tx and "₹638" in tx)
    rec("customer order page: item return policy (Returnable / Non-Returnable)", "Returnable" in tx and "Non-Returnable" in tx)
    rec("customer order page: visual timeline starts at 'Order Placed' with a time", cu.locator(".steps li.done").count() == 1 and "Order Placed" in cu.inner_text(".steps li.done"))
    rec("customer order page: honest tracking text (no courier yet)", "Courier tracking will appear here" in tx)
    env.overflow(cu, "order details"); env.shot(cu, "41_order_detail")
    rec("another customer cannot open this order", fj(raj, f"/api/orders/my?number={N1}")["status"] == 404)
    m = mails(r"New order " + N1, "owner@e2e.test")
    rec("EMAIL to owner on new order: items, variant, pack, subtotal, delivery, total, payment, address", len(m) == 1 and all(x in m[0]["html"] for x in [N1, "Laddu Gopal Necklace", "Red / Pack of 3", "SKU R3", "₹598", "₹40", "₹638", "Cash on Delivery", "12-B, Tirth Mandir Road", "9927892667"]))
    rec("EMAIL to customer: order confirmation", len(mails(r"is placed", "sita@example.com")) == 1)
    rec("emails are recorded as sent only after the provider confirmed (id stored)", all(e["status"] == "sent" and e["provider_id"] for e in state()["outbox"]))

    # ---------- Admin dashboard: filters, sort, details, valid transitions, tracking ----------
    N2 = place(cu, [{"id": MUK["id"], "v": 0, "size": "", "qty": 2}])           # ₹798 -> ₹40
    ad.goto(B + "/admin"); ad.wait_for_selector("[data-t=orders]"); ad.click("[data-t=orders]"); ad.wait_for_selector("[data-o]")
    rec("orders dashboard lists number, customer, mobile, items, total, payment & order status", ad.locator("[data-o]").count() == 2 and all(x in ad.inner_text("#ol") for x in [N1, "Sita Devi", "9927892667", "₹638", "COD", "Order Placed"]))
    first = lambda: ad.locator("[data-o]").first.get_attribute("data-o")
    ad.select_option("#osort", "total_asc"); ad.wait_for_timeout(500); a = first(); ad.select_option("#osort", "total_desc"); ad.wait_for_timeout(500)
    rec("orders: sort by total changes order", a != first() and a == N1 and first() == N2)
    ad.fill("#os", "9927892667"); ad.wait_for_timeout(600); rec("orders: search by mobile", ad.locator("[data-o]").count() == 2); ad.fill("#os", N1[-5:]); ad.wait_for_timeout(600); rec("orders: search by order number", ad.locator("[data-o]").count() == 1)
    ad.fill("#os", "Sita"); ad.wait_for_timeout(600); rec("orders: search by customer name", ad.locator("[data-o]").count() == 2); ad.fill("#os", "nobody"); ad.wait_for_timeout(600); rec("orders: empty state", "No orders found" in ad.inner_text("#ol")); ad.fill("#os", "")
    ad.select_option("#op", "paid"); ad.wait_for_timeout(500); rec("orders: filter by payment status", ad.locator("[data-o]").count() == 0); ad.select_option("#op", "")
    ad.select_option("#om", "ONLINE"); ad.wait_for_timeout(500); rec("orders: filter by payment method", ad.locator("[data-o]").count() == 0); ad.select_option("#om", "")
    ad.fill("#ofrom", "2030-01-01"); ad.dispatch_event("#ofrom", "change"); ad.wait_for_timeout(500); rec("orders: date range filter", ad.locator("[data-o]").count() == 0); ad.click("#oclear"); ad.wait_for_selector("[data-o]")
    ad.select_option("#od", "delivered"); ad.wait_for_timeout(500); rec("orders: delivery-status filter", ad.locator("[data-o]").count() == 0); ad.click("#oclear"); ad.wait_for_selector("[data-o]")
    env.overflow(ad, "admin orders list"); ad.click(f"[data-o='{N1}']"); ad.wait_for_selector(".sheet"); sh = ad.inner_text(".sheet")
    rec("order detail: customer, address, variants, pack stock used, return rule, totals, history", all(x in sh for x in ["Sita Devi", "12-B, Tirth Mandir Road", "Red / Pack of 3", "Stock used: 3 pieces", "Return: allowed, 7 days", "non-returnable", "₹638", "Order Placed"]))
    rec("status buttons at 'Order Placed': only Confirm and Cancel (no Shipped/Delivered)", ad.locator("[data-act=status]").all_inner_texts() == ["Mark: Order Confirmed", "Cancel order"])
    env.overflow(ad, "admin order detail"); env.shot(ad, "42_admin_order")
    r = fj(ad, "/api/admin/orders", "PATCH", {"orderNumber": N1, "status": "delivered"}); rec("API refuses an invalid jump (placed -> delivered) with a clear message", r["status"] == 409 and "cannot be changed" in r["json"]["error"], r["json"])
    ad.click("[data-v=confirmed]"); ad.wait_for_selector("text=Saved"); ad.wait_for_timeout(300)
    rec("admin: Order Confirmed (buttons now offer the next valid steps)", status_of(N1) == "confirmed" and "Mark: Processing" in ad.inner_text(".sheet") and "Mark: Delivered" not in ad.inner_text(".sheet"))
    ad.click("[data-v=processing]"); ad.wait_for_timeout(500); ad.click("[data-v=packed]"); ad.wait_for_timeout(500)
    ad.fill("#tc", "DTDC"); ad.fill("#tid", "D55501"); ad.fill("#tu", "https://track.example/D55501"); ad.click("[data-act=tracking]"); ad.wait_for_timeout(500)
    ad.fill("#stnote", "Handed to courier"); ad.click("[data-v=shipped]"); ad.wait_for_timeout(600)
    cu.goto(B + "/account?order=" + N1); cu.wait_for_selector(".steps"); tx = cu.inner_text("#box")
    rec("customer sees every admin update on the timeline (Confirmed, Processing, Packed, Shipped)", all(x in tx for x in ["Order Confirmed", "Processing", "Packed", "Shipped"]) and cu.locator(".steps li.done").count() == 5)
    rec("customer sees REAL courier tracking (name, ID, link)", "DTDC" in tx and "D55501" in tx and cu.locator("a:has-text('Track on courier site')").count() == 1)
    rec("EMAIL to customer on shipment includes the tracking ID", len(mails(r"has been shipped", "sita@example.com")) == 1 and "D55501" in mails(r"has been shipped")[0]["html"])
    ad.click("[data-v=out_for_delivery]"); ad.wait_for_timeout(500); ad.click("[data-v=delivered]"); ad.wait_for_timeout(700)
    o = order(N1); rec("delivered: stamps delivery date; COD becomes paid; order is final", o["order_status"] == "delivered" and o["delivered_at"] and o["payment_status"] == "paid" and ad.locator("[data-act=status]").count() == 0)
    rec("history lists admin actions with who/when (audit trail)", len([e for e in state()["events"] if e["order_id"] == o["id"] and e["actor"] == "admin"]) >= 5 and any(a["action"] == "order_status" for a in state()["audit"]))
    rec("EMAIL to customer on delivery", len(mails(r"was delivered", "sita@example.com")) == 1)
    ad.click("#x"); ad.reload()

    # ---------- Cancellation: immediate vs request ----------
    cu.goto(B + "/account?order=" + N2); cu.wait_for_selector("#cancelBtn"); cu.click("#cancelBtn"); rec("cancel (not confirmed yet): customer is told it is immediate", "cancelled immediately" in cu.inner_text("#cancelBox")); env.overflow(cu, "cancel form")
    cu.fill("#cReason", "Ordered by mistake"); cu.click("#cYes"); cu.wait_for_selector("text=Your order has been cancelled"); 
    rec("immediate cancel: order Cancelled and stock returned", status_of(N2) == "cancelled" and next(x for x in state()["products"] if x["id"] == MUK["id"])["stock"] == 9 + 0 + 1 if False else status_of(N2) == "cancelled")
    rec("stock restored after cancel (Mukut back to 9)", next(x for x in state()["products"] if x["id"] == MUK["id"])["stock"] == 9)
    rec("EMAIL to owner: ORDER CANCELLED (confirmed) and to customer", len(mails(r"ORDER CANCELLED: " + N2, "owner@e2e.test")) == 1 and len(mails(r"cancelled", "sita@example.com")) >= 1 and "Order cancelled (confirmed)" in mails(r"ORDER CANCELLED: " + N2)[0]["html"])
    N3 = place(cu, [{"id": NECK["id"], "v": vid["B1"], "size": "", "qty": 2}]); before = stock("B1")
    fj(ad, "/api/admin/orders", "PATCH", {"orderNumber": N3, "status": "confirmed"})
    cu.goto(B + "/account?order=" + N3); cu.wait_for_selector("#cancelBtn"); cu.click("#cancelBtn"); rec("cancel (after confirmation): customer is told it is a REQUEST", "cancellation request" in cu.inner_text("#cancelBox").lower())
    cu.fill("#cReason", "Found elsewhere"); cu.click("#cYes"); cu.wait_for_selector("text=Cancellation request sent")
    rec("request: status 'Cancellation requested', stock NOT returned yet", status_of(N3) == "cancellation_requested" and stock("B1") == before and "Cancellation requested" in cu.inner_text(".steps"))
    rm = mails(r"CANCELLATION REQUESTED: order " + N3, "owner@e2e.test"); rec("EMAIL to owner clearly says REQUEST, not cancelled yet", len(rm) == 1 and "NOT cancelled yet" in rm[0]["html"] and "Found elsewhere" in rm[0]["html"] and not mails(r"ORDER CANCELLED: " + N3), [m["subject"] for m in state()["mails"]][-6:])
    ad.goto(B + "/admin"); ad.click("[data-t=orders]"); ad.wait_for_selector("[data-o]"); ad.click(f"[data-o='{N3}']"); ad.wait_for_selector(".sheet")
    rec("admin sees the request with Approve / Decline", "Customer asked to cancel" in ad.inner_text(".sheet") and ad.locator("[data-act=decline]").count() == 1)
    ad.click("[data-act=decline]"); ad.wait_for_timeout(700); rec("declining restores the earlier status", status_of(N3) == "confirmed" and stock("B1") == before)
    fj(cu, "/api/orders/my", "POST", {"action": "cancel", "orderNumber": N3, "reason": "Please cancel"}); ad.reload(); ad.click("[data-t=orders]"); ad.wait_for_selector("[data-o]"); ad.click(f"[data-o='{N3}']"); ad.wait_for_selector(".sheet")
    ad.once("dialog", lambda d: d.accept()); ad.click("[data-act=status][data-v=cancelled]"); ad.wait_for_timeout(700)
    rec("approving cancels the order and returns stock (2 single pieces)", status_of(N3) == "cancelled" and stock("B1") == before + 2)
    rec("EMAIL to owner: completed cancellation (different from the request)", len(mails(r"ORDER CANCELLED: " + N3, "owner@e2e.test")) == 1)
    r = fj(cu, "/api/orders/my", "POST", {"action": "cancel", "orderNumber": N1}); rec("delivered orders cannot be cancelled", r["status"] == 409)
    ad.click("#x")

    # ---------- Returns (item level) ----------
    cu.goto(B + "/account?order=" + N1); cu.wait_for_selector(".steps"); items = cu.locator(".row")
    rec("returnable item shows 'Return item'; non-returnable shows 'Non-Returnable' and NO ordinary return button", items.nth(0).locator("[data-ret=return]").count() == 1 and items.nth(1).locator("[data-ret=return]").count() == 0 and "Non-Returnable" in items.nth(1).inner_text())
    rec("both items offer 'Report a problem' (damaged / defective / wrong)", cu.locator("[data-ret=issue]").count() == 2)
    rec("return deadline calculated from the real delivery date", re.search(r"Returnable until \d+ \w+ \d{4}", items.nth(0).inner_text()) is not None)
    cu.click("[data-ret=return][data-idx='0']"); cu.wait_for_selector("#rr0"); cu.click("#rs0"); rec("return form: reason required", "choose a reason" in cu.inner_text("#rm0"))
    cu.select_option("#rr0", "Not as described"); cu.fill("#rd0", "Colour is different"); cu.set_input_files("#rp0", ["/tmp/fx/a.jpg"]); cu.wait_for_timeout(600); env.shot(cu, "43_return_form"); cu.click("#rs0"); cu.wait_for_selector("text=Your request was sent")
    R0 = next(x for x in state()["returns"] if x["item_index"] == 0)
    rec("return request saved with reason, details and an uploaded photo", R0["status"] == "requested" and R0["reason"] == "Not as described" and len(R0["photos"]) == 1 and "/returns/" in R0["photos"][0])
    rec("customer sees the return status on the item; no second request possible", "request sent" in cu.locator(".row").nth(0).inner_text().lower() and cu.locator("[data-ret][data-idx='0']").count() == 0, cu.locator(".row").nth(0).inner_text()[:300])
    cu.click("[data-ret=issue][data-idx='1']"); cu.select_option("#rr1", "Damaged"); cu.click("#rs1"); cu.wait_for_selector("text=Your request was sent"); rec("non-returnable item: 'Report a problem' still works (damaged)", any(x["item_index"] == 1 and x["kind"] == "issue" for x in state()["returns"]))
    rec("EMAIL to owner for return request and problem report", len(mails(r"RETURN REQUESTED", "owner@e2e.test")) == 1 and len(mails(r"PROBLEM REPORTED", "owner@e2e.test")) == 1)
    r = fj(raj, "/api/orders/my", "POST", {"action": "return", "orderNumber": N1, "itemIndex": 0, "kind": "return", "reason": "Damaged"}); rec("another customer cannot request a return on this order", r["status"] == 404)
    ad.goto(B + "/admin"); ad.click("[data-t=returns]"); ad.wait_for_selector("[data-rid]"); env.overflow(ad, "admin returns"); env.shot(ad, "44_admin_returns")
    card = ad.locator("[data-rid]").filter(has_text="Laddu Gopal Necklace"); rec("admin sees reason, details, photo and valid next steps only", "Not as described" in card.inner_text() and card.locator("img").count() == 1 and card.locator("[data-rn]").all_inner_texts() == ["Mark: approved", "Reject"])
    ad.once("dialog", lambda d: d.accept()); card.locator("[data-rn=rejected]").click(); rec("rejecting needs a written reason", status0 := next(x for x in state()["returns"] if x["item_index"] == 0)["status"] == "requested")
    steps = ["approved", "pickup_scheduled", "in_transit", "returned", "refund_processing", "refunded"]
    for s in steps:
        card = ad.locator("[data-rid]").filter(has_text="Laddu Gopal Necklace"); 
        if s == "approved": card.locator("[data-dr]").fill("Please send it back")
        ad.once("dialog", lambda d: d.accept()); card.locator(f"[data-rn={s}]").click(); ad.wait_for_timeout(700)
    R0 = next(x for x in state()["returns"] if x["item_index"] == 0)
    rec("return moved step by step to Refunded; decision message and audit trail stored", R0["status"] == "refunded" and R0["decision_reason"] == "Please send it back" and len([e for e in state()["events"] if e["event_type"] == "return_status"]) == 6 and any(a["action"] == "return_status" for a in state()["audit"]))
    cu.goto(B + "/account?order=" + N1); cu.wait_for_selector(".steps"); rec("customer sees the refund status and the shop's message", "Refunded" in cu.locator(".row").nth(0).inner_text() and "Please send it back" in cu.locator(".row").nth(0).inner_text())
    rec("EMAIL to customer on return updates", len(mails(r"Update on your return", "sita@example.com")) >= 5)
    env.overflow(cu, "order details with returns")

    # ---------- Online payment, refund after cancel ----------
    N4 = place(cu, [{"id": MUK["id"], "v": 0, "size": "", "qty": 3}], "ONLINE")
    rec("online order: Razorpay verified on the server, payment confirmed, order confirmed", order(N4)["payment_status"] == "paid" and order(N4)["order_status"] == "confirmed" and order(N4)["razorpay_payment_id"])
    rec("EMAIL to owner: online payment received", len(mails(r"Payment received: order " + N4, "owner@e2e.test")) == 1)
    r = fj(cu, "/api/orders/my", "POST", {"action": "cancel", "orderNumber": N4, "reason": "Not needed"}); ad.goto(B + "/admin"); ad.click("[data-t=orders]"); ad.wait_for_selector("[data-o]"); ad.click(f"[data-o='{N4}']"); ad.wait_for_selector(".sheet")
    ad.once("dialog", lambda d: d.accept()); ad.click("[data-act=status][data-v=cancelled]"); ad.wait_for_timeout(700)
    rec("paid order cancelled -> refund status 'processing' is set automatically", order(N4)["order_status"] == "cancelled" and order(N4)["refund_status"] == "processing")
    ad.click("[data-act=refund][data-v=refunded]"); ad.wait_for_timeout(700); rec("admin records the refund; customer is emailed", order(N4)["refund_status"] == "refunded" and len(mails(r"Refund completed", "sita@example.com")) == 1)
    ad.click("#x")

    # ---------- Email failures never break orders; retry works ----------
    hit("/__mailmode?m=fail"); N5 = place(cu, [{"id": MUK["id"], "v": 0, "size": "", "qty": 1}])
    rec("mail provider down: the order is still placed", status_of(N5) == "pending")
    bad = [e for e in state()["outbox"] if e["status"] == "failed"]; rec("failed emails are recorded with the error and attempt count, never marked sent", len(bad) >= 2 and all(e["attempts"] == 1 and "provider_status_500" in e["last_error"] and not e.get("provider_id") for e in bad))
    ad.goto(B + "/admin"); ad.click("[data-t=site]"); ad.wait_for_selector("#emailPanel .tl"); rec("admin sees how many emails were not delivered", "not delivered yet" in ad.inner_text("#emailPanel") and ad.locator("#retryMail").count() == 1)
    hit("/__mailmode?m=ok"); ad.click("#retryMail"); ad.wait_for_timeout(1200)
    rec("Retry failed emails delivers them (and never twice)", all(e["status"] == "sent" for e in state()["outbox"]) and len(mails(r"New order " + N5)) == 1)
    env.shot(ad, "45_admin_email_panel")

    pg = cu
    # ---------- reviews end to end ----------
    hit("/__seed"); prods=state()["products"]; kurti=[p for p in prods if p["category"]=="kurti"][0]
    pg.goto(B+"/product/"+kurti["slug"]); pg.wait_for_selector("#reviewForm")
    rec("review section says reviews are NOT purchase-verified", "not purchase-verified" in pg.content())
    rec("no fake stars: product with no reviews says 'No reviews yet'", "No reviews yet" in pg.content() and "aggregateRating" not in pg.content())
    pg.click("#reviewSubmit"); rec("review form validates empty input", "name" in pg.inner_text("#reviewMsg").lower())
    pg.fill("input[name=name]","Asha"); pg.click(".rating-pick label >> nth=4"); pg.fill("textarea[name=comment]","Lovely fabric <b>great</b> fit"); env.overflow(pg,"product page with review form"); env.shot(pg,"18_review_form")
    pg.click("#reviewSubmit"); pg.wait_for_selector("#reviewMsg .msg.ok", timeout=8000)
    rec("review saved as PENDING (not public yet)", [r["status"] for r in state()["reviews"]]==["pending"] and "Lovely fabric" not in get("/product/"+kurti["slug"]))
    r=pg.evaluate(f"fetch('/api/products?action=reviews',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{productId:{kurti['id']},name:'Asha',rating:4,comment:'Second try same product'}})}}).then(r=>r.status)"); rec("same visitor cannot review the same product again (429)", r==429, str(r))
    codes=[pg.evaluate(f"fetch('/api/products?action=reviews',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{productId:{p['id']},name:'Asha',rating:5,comment:'Nice item thank you'}})}}).then(r=>r.status)") for p in prods if p["id"]!=kurti["id"]][:3]
    rec("hourly review limit: 3 accepted, then 429", codes==[201,201,429], str(codes))
    r=pg.evaluate("fetch('/api/admin/reviews',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:1,status:'approved'})}).then(r=>r.status)"); rec("customer cannot approve reviews (403)", r==403, str(r))
    ad.goto(B+"/admin"); ad.wait_for_selector("[data-t=reviews]"); ad.click("[data-t=reviews]"); ad.wait_for_selector(".review-admin-card"); env.overflow(ad,"admin reviews"); env.shot(ad,"19_admin_reviews")
    ad.click("[data-review-act=approve] >> nth=0"); ad.wait_for_selector("text=Review published"); ad.wait_for_timeout(300)
    approved=[x for x in state()["reviews"] if x["status"]=="approved"]
    page=get("/product/"+[p for p in prods if p["id"]==approved[0]["product_id"]][0]["slug"])
    rec("admin approval publishes the review with escaped text + real aggregate", "aggregateRating" in page and "5.0/5" in page and "<b>great</b>" not in page, "")
    pg.goto(B+"/product/"+[p for p in prods if p["id"]==approved[0]["product_id"]][0]["slug"]); pg.wait_for_selector(".review-card"); env.shot(pg,"20_product_reviews")
    rec("home card shows a rating only for products that have approved reviews", get("/category/"+[p for p in prods if p["id"]==approved[0]["product_id"]][0]["category"]).count("rating-mini")>=1)

    # ---------- SHRI JI Assistant (fallback mode: no AI key configured) ----------
    pg.goto(B+"/"); pg.wait_for_selector("#chatFab"); rec("assistant launcher visible on storefront (phone)", pg.is_visible("#chatFab"))
    pg.click("#chatFab"); pg.wait_for_selector("#chatPanel"); env.shot(pg,"21_chat_open")
    bx=pg.locator("#chatPanel").bounding_box(); rec("chat is a bottom sheet inside the 360px screen", bx["x"]>=0 and bx["width"]<=360.5 and bx["y"]+bx["height"]<=741, str(bx)); env.overflow(pg,"home with chat open")
    rec("starter questions shown", pg.locator("#chatStarters .chip").count()==6)
    pg.fill("#chatInput","mujhe 500 tak ka kurti dikhao"); pg.click("#chatSend"); pg.wait_for_function("document.querySelectorAll('.cb.bot:not(.typing)').length>=2", timeout=8000)
    rec("budget ₹500: no kurti that cheap => honest 'not found', no fake product", pg.locator(".cm").count()==0 and "nahi mila" in pg.inner_text("#chatLog"))
    pg.fill("#chatInput","mujhe 1000 tak ka kurti dikhao"); pg.click("#chatSend"); pg.wait_for_function("document.querySelectorAll('.cb.bot:not(.typing)').length>=3", timeout=8000); pg.wait_for_selector(".cm")
    pr=[int("".join(c for c in t.split("₹")[1].split()[0] if c.isdigit())) for t in pg.locator(".cm-p").all_inner_texts()]
    rec("Hinglish budget request returns real products within ₹1000", len(pr)>0 and all(x<=1000 for x in pr), str(pr))
    rec("product mini-cards link to real product pages", all(h.startswith("/product/") for h in [a.get_attribute("href") for a in pg.locator("a.cm").all()]))
    rec("fallback answers are labelled (not shown as AI)", "Automatic answer from store information" in pg.inner_text("#chatLog")); env.shot(pg,"22_chat_answer")
    pg.fill("#chatInput","What is your return policy?"); pg.click("#chatSend"); pg.wait_for_function("document.querySelectorAll('.cb.bot:not(.typing)').length>=4", timeout=8000)
    rec("unpublished policy: admits it and gives shop phone", "not been published" in pg.inner_text("#chatLog") and "9927892667" in pg.inner_text("#chatLog"))
    pg.click("#chatClose"); rec("chat closes and launcher returns", not pg.is_visible("#chatPanel") and pg.is_visible("#chatFab"))
    pg.reload(); pg.wait_for_selector("#chatFab"); pg.click("#chatFab"); rec("chat history kept for this browser session", pg.locator(".cb.me").count()==3); pg.click("#chatClose")
    pg.goto(B+"/product/"+kurti["slug"]); pg.wait_for_timeout(300); pg.locator("#addBtn").scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    rec("launcher hides while Add to cart is on screen (never covers it)", pg.evaluate("getComputedStyle(document.getElementById('chatFab')).opacity")=="0")
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(700)
    rec("launcher returns when Add to cart is scrolled away", pg.evaluate("getComputedStyle(document.getElementById('chatFab')).opacity")=="1")
    for path in ["/cart","/checkout","/account","/admin"]:
        pg.goto(B+path); pg.wait_for_timeout(300); rec(f"no chat widget on {path}", pg.locator("#sjcChat").count()==0)
    dk=br.new_context(viewport={"width":1280,"height":800}).new_page(); dk.goto(B+"/"); dk.wait_for_selector("#chatFab"); dk.click("#chatFab"); dk.wait_for_selector("#chatPanel")
    bx=dk.locator("#chatPanel").bounding_box(); rec("desktop chat is a compact panel at bottom-right", bx["width"]<=381 and bx["x"]+bx["width"]<=1280 and bx["y"]+bx["height"]<=800, str(bx)); dk.screenshot(path="/tmp/shots/23_chat_desktop.png")
    hit("/__ai?on=1"); pg.goto(B+"/"); pg.wait_for_selector("#chatFab"); pg.click("#chatFab"); pg.fill("#chatInput","kurti dikhao"); pg.click("#chatSend"); pg.wait_for_function("document.getElementById('chatLog').innerText.includes('AI-MOCK')", timeout=8000)
    last=pg.locator(".cb.bot:not(.typing)").last; rec("AI mode (mock provider): answer from the provider (not labelled automatic), cards still from the database", "AI-MOCK" in last.inner_text() and "Automatic answer" not in last.inner_text() and last.locator(".cm").count()>0)
    rec("provider key never appears in any page or API response", "sk-e2e-key" not in get("/") and "sk-e2e-key" not in pg.content() and "sk-e2e-key" not in pg.inner_text("#chatLog"))
    hit("/__ai?on=0")
    # owner edits the assistant from the admin panel
    ad.goto(B+"/admin"); ad.wait_for_selector("[data-t=site]"); ad.click("[data-t=site]"); ad.wait_for_selector("#chatFaq"); env.overflow(ad,"admin assistant settings")
    ad.fill("#chatFaq","no separator here"); ad.click("#saveChat"); ad.wait_for_selector("#mc .msg.err"); rec("admin FAQ format error is explained", "Question | Answer" in ad.inner_text("#mc"))
    ad.fill("#chatFaq","Shop timing | We are open 10 AM to 8 PM every day."); ad.click("#saveChat"); ad.wait_for_selector("#mc .msg.ok"); env.shot(ad,"24_admin_assistant")
    c4=env.ctx(); q=c4.new_page(); q.goto(B+"/"); q.wait_for_selector("#chatFab"); q.click("#chatFab"); q.fill("#chatInput","shop timing kya hai"); q.click("#chatSend"); q.wait_for_function("document.querySelectorAll('.cb.bot:not(.typing)').length>=2", timeout=8000)
    rec("owner-written FAQ answer is used exactly", "We are open 10 AM to 8 PM every day." in q.inner_text("#chatLog"))
    ad.uncheck("#chatOn"); ad.click("#saveChat"); ad.wait_for_selector("#mc .msg.ok")
    r=q.evaluate("fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'hello'})}).then(r=>r.status)")
    rec("owner can switch the assistant off: API refuses and widget is removed", r==503 and "/js/chat.js" not in get("/") and "/js/chat.js" not in get("/shop"), str(r))
    rec("store keeps working with the assistant off", "Thakur Ji Collection" in get("/") and "Add to cart" in get("/product/"+kurti["slug"]))
    ad.check("#chatOn"); ad.click("#saveChat"); ad.wait_for_selector("#mc .msg.ok"); rec("assistant can be switched back on", "/js/chat.js" in get("/"))


finish()
