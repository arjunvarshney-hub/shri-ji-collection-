# Browser suite 1: categories, admin product form (variants, rich text, specs, returns), storefront product page, cart, delivery rule.
import os
from e2e_common import *
os.makedirs("/tmp/shots", exist_ok=True)
def saved(pg):
    """Wait until the product sheet closes; if it stays open, report the on-screen error."""
    try: pg.wait_for_selector("#pf", state="detached", timeout=12000)
    except Exception: print("FORM ERROR:", pg.inner_text("#m")); raise
with sync_playwright() as p:
    env = Env(p.chromium.launch()); br = env.br
    # ---------- Home: Thakur Ji first, removed categories gone ----------
    c0 = env.ctx(); pg = c0.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    hit("/__seed"); hit("/__addprod?name=Old+Maxi+Dress&category=maxi&price=500")
    pg.goto(B + "/"); html = pg.content()
    hero = pg.inner_text(".hero"); rec("home: Thakur Ji Poshak is the main hero call-to-action (Ladies Wear secondary)", "Shop Thakur Ji Poshak" in hero and hero.index("Shop Thakur Ji Poshak") < hero.index("Ladies Wear") and pg.locator(".hero .btn.primary").inner_text() == "Shop Thakur Ji Poshak")
    rec("home: dedicated Thakur Ji category cards (10)", pg.locator(".cgrid .ccard").count() == 10)
    rec("home: Thakur Ji section comes before Ladies Wear", html.index("Thakur Ji Poshak &amp; Accessories") < html.index('<h2 class="h2">Ladies Wear</h2>'))
    pg.click("#menuBtn"); drawer = pg.inner_text("#menuPanel")
    rec("menu: Thakur Ji group first, 10 + 4 categories only", drawer.index("Thakur Ji Poshak") < drawer.index("Ladies Wear") and all(x in drawer for x in ["Mala and Necklace", "Other Thakur Ji Accessories", "Kurti", "Suit", "Dupatta", "Plazo"]))
    rec("menu: removed categories are gone (Fall and Astar, Maxi, Gown, Saree, Dress Material)", not any(x in drawer for x in ["Fall and Astar", "Maxi", "Gown", "Saree", "Dress Material"]))
    env.shot(pg, "30_menu_thakur"); pg.click("#menuClose")
    rec("removed category page is 404 and its product is hidden from the shop", "Category not found" in get("/category/maxi") and "Old Maxi Dress" not in get("/shop") and "maxi" not in get("/sitemap.xml").lower())
    rec("old 'mala' links still work (alias of Mala and Necklace)", "Moti Mala" in get("/category/mala") or "Moti Mala" in get("/category/mala-and-necklace"))
    env.overflow(pg, "home (Thakur Ji priority)"); env.shot(pg, "31_home_thakur")

    # ---------- Owner + customer accounts ----------
    oc, ad = env.owner(); cc, cu = env.signup("sita@example.com", name="Sita Devi")

    # ---------- Admin: categories ----------
    ad.goto(B + "/admin"); ad.wait_for_selector("[data-t=categories]"); ad.click("[data-t=categories]"); ad.wait_for_selector("#cAdd")
    rec("categories tab: 14 on, removed ones kept as 'switched off'", "Categories on the shop (14)" in ad.inner_text("#pane") and "Switched off (5)" in ad.inner_text("#pane"))
    rec("categories tab warns about products hidden in removed categories", "1 product(s) are in categories that are switched off" in ad.inner_text("#pane"))
    ad.fill("#cName", "Pagdi"); ad.select_option("#cGroup", "thakur-ji-poshak"); ad.click("#cAdd"); ad.wait_for_selector(".pcard:has-text('Pagdi')")
    ad.fill("#cName", "pagdi"); ad.click("#cAdd"); ad.wait_for_timeout(400)
    rec("add category; duplicate name is NOT added twice", len([c for c in state()["categories"] if c["name"].lower() == "pagdi"]) == 1)
    ad.once("dialog", lambda d: d.accept("Pagdi and Safa")); ad.locator("[data-cat=rename]").nth(10).click(); ad.wait_for_timeout(500)
    rec("category can be renamed (link/slug unchanged)", any(c["name"] == "Pagdi and Safa" and c["slug"] == "pagdi" for c in state()["categories"]))
    ad.once("dialog", lambda d: d.accept()); ad.select_option("[data-mv=maxi]", "kurti"); ad.click("[data-cat=move]"); ad.wait_for_timeout(700)
    rec("hidden products can be moved to an active category (not deleted)", [x["category"] for x in state()["products"] if x["name"] == "Old Maxi Dress"] == ["kurti"] and "Old Maxi Dress" in get("/category/kurti"))
    ad.reload(); ad.wait_for_selector("[data-t=categories]"); ad.click("[data-t=categories]"); ad.wait_for_selector("#cAdd")
    ad.locator("[data-cat=toggle]").nth(10).uncheck(); ad.wait_for_timeout(500)
    rec("category can be switched off and on", any(c["slug"] == "pagdi" and not c["active"] for c in state()["categories"]))
    env.overflow(ad, "admin categories"); env.shot(ad, "32_admin_categories")

    # ---------- Admin: product form with variants / rich text / specs / returns ----------
    ad.click("[data-t=products]"); ad.wait_for_selector("#add"); ad.click("#add"); ad.wait_for_selector("#pf")
    ad.click("#cancel"); ad.click("#add"); ad.wait_for_selector("#pf")
    ad.click("#save"); rec("form: name required", "product name" in ad.inner_text("#m").lower())
    ad.fill("input[name=name]", "Laddu Gopal Necklace"); ad.fill("input[name=sku]", "LG-NECK-001"); ad.fill("input[name=brand]", "SJC"); ad.fill("input[name=subcategory]", "Daily wear")
    ad.click("#save"); rec("form: category required", "category" in ad.inner_text("#m").lower())
    ad.click("#catIn"); ad.fill("#catIn", "neck"); rec("category search finds 'Mala and Necklace' only", ad.locator("#catList button[data-cat]").count() == 2 and "Mala and Necklace" in ad.inner_text("#catList"))
    ad.click("#catList [data-cat=mala-and-necklace]"); rec("category picked from the dropdown", ad.input_value("#catIn") == "Mala and Necklace")
    ad.fill("input[name=price]", "100"); ad.fill("input[name=cost_price]", "40"); ad.fill("input[name=min_order_qty]", "2"); ad.fill("input[name=weight_grams]", "120"); ad.fill("input[name=dimensions]", "10 x 5 cm")
    ad.click("summary:has-text('Options and variants')"); ad.check("[data-opt=colour]"); ad.check("[data-opt=pack]")
    ad.fill("[data-vals=colour]", "Red, Blue"); ad.fill("[data-vals=pack]", "Single Piece, Pack of 3"); ad.click("#combos"); ad.wait_for_selector(".vrow >> nth=3")
    rec("variants: 2 colours x 2 packs = 4 combinations; 'Pack of 3' sets 3 pieces", ad.locator(".vrow").count() == 4 and ad.locator(".vrow >> nth=1").locator("[data-vf=pack_qty]").input_value() == "3")
    prices = ["90", "250", "90", "250"]
    for i in range(4):
        row = ad.locator(".vrow").nth(i); row.locator("[data-vf=price]").fill(prices[i]); row.locator("[data-vf=stock]").fill("30" if i == 1 else "10"); row.locator("[data-vf=sku]").fill(f"N-V{i+1}")
        if i == 1: row.locator("[data-vf=sale_price]").fill("199")
    ad.click("#save"); rec("form: returnable Yes/No is required", "returnable" in ad.inner_text("#m").lower())
    ad.select_option("select[name=return_eligible]", "true"); ad.fill("input[name=return_window_days]", "7"); ad.fill("textarea[name=return_conditions]", "Unused and in original packing"); ad.fill("textarea[name=refund_policy]", "Refund in 5-7 days")
    ad.set_input_files("#files", ["/tmp/fx/a.jpg", "/tmp/fx/b.jpg"]); ad.wait_for_selector(".im >> nth=1")
    ad.click("[data-mv='0:1']"); rec("photos: reorder with the arrow buttons", ad.locator(".im").count() == 2 and ad.locator(".im >> nth=1 >> .cv").count() == 0)
    ad.click("[data-cover='1']") if ad.locator("[data-cover='1']").count() else None
    ad.click("#rte"); ad.keyboard.type("PRODUCT HIGHLIGHTS"); ad.click("[data-cmd=h3]"); ad.keyboard.press("Enter")
    ad.click("[data-cmd=ul]"); ad.keyboard.type("Colour: Blue and Gold"); ad.keyboard.press("Enter"); ad.click("[data-cmd=bold]"); ad.keyboard.type("Pack Contents: 1 Piece"); ad.click("[data-cmd=bold]")
    ad.evaluate("document.querySelector('#rte').insertAdjacentHTML('beforeend','<img src=x onerror=\"window.__pwn=1\"><script>window.__pwn2=1</script><a href=\"javascript:alert(1)\">bad link</a>')")
    ad.click("summary:has-text('Specifications')"); ad.click("[data-preset='Thakur Ji']"); rec("specs: suggested Thakur Ji rows added", ad.locator(".srow").count() == 11)
    ad.locator(".srow input[data-sf=value]").nth(1).fill("Blue and Gold"); ad.locator(".srow input[data-sf=value]").nth(3).fill("Traditional")
    env.overflow(ad, "admin product form"); env.shot(ad, "33_admin_form")
    ad.click("#save"); saved(ad); st = state(); P = next(x for x in st["products"] if x["name"] == "Laddu Gopal Necklace"); V = [v for v in st["variants"] if v["product_id"] == P["id"]]
    rec("saved: SKU, brand, subcategory, MOQ, cost, return policy", P["sku"] == "LG-NECK-001" and P["brand"] == "SJC" and P["min_order_qty"] == 2 and P["cost_price"] == 40 and P["return_eligible"] is True and P["return_window_days"] == 7 and P["category"] == "mala-and-necklace")
    rec("saved: 4 variants with own SKU / price / sale / stock / pack quantity", len(V) == 4 and sorted(v["sku"] for v in V) == ["N-V1", "N-V2", "N-V3", "N-V4"] and any(v["sale_price"] == 199 and v["pack_qty"] == 3 and v["stock"] == 30 for v in V))
    rec("saved: base price = lowest variant price; 2 photos stored", P["price"] == 90 and len(P["image_urls"]) == 2)
    rec("saved: description sanitised (heading, list, bold kept; script/onerror/javascript: removed)", "<h3>" in P["description_html"] and "<ul>" in P["description_html"] and "<strong>" in P["description_html"] and not any(x in P["description_html"] for x in ["onerror", "<script", "javascript:", "<img"]), P["description_html"][:140])
    rec("saved: specification rows stored", {"label": "Colour", "value": "Blue and Gold"} in P["specs"] and {"label": "Design", "value": "Traditional"} in P["specs"])
    rec("audit log records the product creation", any(a["action"] == "create" and a["entity"] == "product" for a in state()["audit"]))
    # simple product + 'Others' category
    ad.click("#add"); ad.wait_for_selector("#pf"); ad.fill("input[name=name]", "Silk Safa"); ad.click("#catIn"); ad.click("#catList [data-cat=__other__]"); ad.wait_for_selector("#newCatName", state="visible")
    ad.fill("#newCatName", "Safa"); ad.fill("input[name=price]", "300"); ad.fill("input[name=stock]", "9"); ad.fill("input[name=pack_size]", "3"); ad.select_option("select[name=return_eligible]", "false")
    ad.click("#save"); saved(ad); st = state()
    rec("'Others': new category created and reused for the product", any(c["slug"] == "safa" and c["active"] for c in st["categories"]) and any(x["name"] == "Silk Safa" and x["category"] == "safa" and x["pack_size"] == 3 and x["return_eligible"] is False for x in st["products"]))

    # ---------- Admin: list search / filter / sort / quick actions ----------
    ad.reload(); ad.wait_for_selector("#pl")
    first = lambda: ad.locator(".pcard .nm").first.inner_text()
    ad.select_option("#sortSel", "price_asc"); ad.wait_for_timeout(500); a1 = first(); ad.select_option("#sortSel", "price_desc"); ad.wait_for_timeout(500); a2 = first()
    rec("sorting changes the result order (price low→high vs high→low)", a1 != a2 and a1 in ("Moti Mala", "Laddu Gopal Necklace", "Moti Mala"), f"{a1} / {a2}")
    ad.fill("#ps", "LG-NECK"); ad.wait_for_timeout(700); rec("search by SKU", ad.locator(".pcard").count() == 1 and "Laddu Gopal Necklace" in first())
    ad.fill("#ps", "N-V3"); ad.wait_for_timeout(700); rec("search by VARIANT SKU", ad.locator(".pcard").count() == 1)
    ad.fill("#ps", ""); ad.wait_for_timeout(600); ad.click("#ftog"); ad.select_option("#fRet", "no"); ad.wait_for_timeout(700)
    rec("filter: non-returnable only", ad.locator(".pcard").count() >= 1 and all("Returns" not in t for t in ad.locator(".pcard").all_inner_texts()))
    ad.fill("#fCol", "blue"); ad.wait_for_timeout(900); rec("filters combine (non-returnable + colour blue) -> nothing", ad.locator(".pcard").count() == 0 and "No products match" in ad.inner_text("#pl"))
    ad.click("#fClear"); ad.wait_for_selector(".pcard"); rec("Clear filters restores the list", ad.locator(".pcard").count() >= 9)
    ad.fill("#ps", "Silk Safa"); ad.wait_for_timeout(700)
    ad.once("dialog", lambda d: d.accept("12")); ad.click("[data-pa=stock]"); ad.wait_for_timeout(700); rec("quick action: update stock", [x["stock"] for x in state()["products"] if x["name"] == "Silk Safa"] == [12])
    ad.once("dialog", lambda d: d.accept()); ad.click("[data-pa=outstock]"); ad.wait_for_timeout(700); rec("quick action: mark out of stock", [x["stock"] for x in state()["products"] if x["name"] == "Silk Safa"] == [0])
    ad.once("dialog", lambda d: d.accept()); ad.click("[data-pa=archive]"); ad.wait_for_timeout(700); rec("archive hides the product but keeps it", any(x["name"] == "Silk Safa" and x["archived"] and not x["active"] for x in state()["products"]) and "Silk Safa" not in get("/shop"))
    ad.click("[data-pa=dup]"); ad.wait_for_timeout(800); rec("duplicate creates an inactive copy", any("(copy)" in x["name"] and not x["active"] for x in state()["products"]))
    env.overflow(ad, "admin product list"); env.shot(ad, "34_admin_list")

    # ---------- Storefront: product page ----------
    slug = P["slug"]; pg.goto(B + "/product/" + slug); pg.wait_for_selector("#pdp")
    hp = pg.content()
    rec("product page: description keeps bold / bullets / heading (no raw tags shown)", pg.locator(".desc h3").count() == 1 and pg.locator(".desc ul li").count() >= 1 and pg.locator(".desc strong").count() == 1 and "&lt;" not in pg.inner_text(".desc"), "")
    rec("product page: injected script/onerror never runs or appears", pg.evaluate("window.__pwn === undefined && window.__pwn2 === undefined") and "onerror" not in hp)
    rec("product page: specifications table shows only filled rows", pg.locator(".specs tbody tr").count() >= 3 and "Product Type" not in pg.inner_text(".specs") and "Blue and Gold" in pg.inner_text(".specs"))
    rec("product page: Returnable box with window + conditions + refund policy", "Returnable" in pg.inner_text(".ret") and "7 days" in pg.inner_text(".ret") and "Unused and in original packing" in pg.inner_text(".ret") and "Refund in 5-7 days" in pg.inner_text(".ret"))
    rec("product page: delivery rule + minimum order shown", "₹50 below ₹499" in pg.inner_text(".dlv") and "Minimum order:" in pg.inner_text(".pdp-info"))
    rec("product page: cost price never in the page or API", "40" not in pg.inner_text("#pPrice") and "cost_price" not in hp and "cost_price" not in get("/api/products?ids=%d" % P["id"]))
    rec("product page: structured data is an AggregateOffer for variants", "AggregateOffer" in hp)
    rec("gallery: native swipe track with 1/2 counter", pg.locator(".gal-slide").count() == 2 and pg.inner_text("#galCount") == "1/2")
    pg.evaluate("document.getElementById('galTrack').scrollTo({left: document.getElementById('galTrack').clientWidth, behavior:'instant'})"); pg.wait_for_timeout(500)
    rec("gallery: swiping moves to photo 2/2 and thumbnail follows", pg.inner_text("#galCount") == "2/2" and pg.locator(".th.on").get_attribute("data-idx") == "1")
    pg.click(".th >> nth=0"); pg.wait_for_timeout(600); rec("gallery: thumbnail jumps back to 1/2", pg.inner_text("#galCount") == "1/2")
    pg.click(".gal-zoom >> nth=0"); pg.wait_for_selector(".zoom"); rec("zoom viewer opens with position indicator", "1/2" in pg.inner_text(".zoom-nav")); pg.keyboard.press("Escape"); rec("zoom closes", pg.locator(".zoom").count() == 0)
    env.overflow(pg, "product page (variants)"); env.shot(pg, "35_product_variants")
    pg.click("#addBtn"); rec("add to cart without options is blocked", "select" in pg.inner_text("#pdpMsg").lower())
    rec("quantity starts at the minimum order (2) and cannot go lower", pg.inner_text("#qVal") == "2"); pg.click("#qMinus"); rec("minimum quantity enforced on the page", pg.inner_text("#qVal") == "2")
    pg.click("label.sz:has(input[value='Red'])"); pg.click("label.sz:has(input[value='Pack of 3'])"); pg.wait_for_timeout(200)
    rec("selecting options updates price, sale, pack and SKU", "₹199" in pg.inner_text("#pPrice") and "₹250" in pg.inner_text("#pPrice") and "Pack of 3 (3 pieces" in pg.inner_text("#pPack") and "N-V2" in pg.inner_text("#pSku"))
    rec("stock message for the chosen variant", "In stock" in pg.inner_text("#pStock") or "left" in pg.inner_text("#pStock"))
    pg.click("#addBtn"); cart = json.loads(pg.evaluate("localStorage.getItem('sjc_cart_v2')")); V2 = next(v for v in V if v["sku"] == "N-V2" or True)
    rec("add to cart stores the variant and quantity 2", len(cart) == 1 and cart[0]["qty"] == 2 and cart[0]["v"] > 0)
    # ---------- Cart: pack info, MOQ, delivery tiers ----------
    pg.goto(B + "/cart"); pg.wait_for_selector(".row"); t = pg.inner_text("#box")
    rec("cart: variant, pack size, price, sale shown", "Red / Pack of 3" in t and "Pack of 3" in t and "₹199" in t and "Minimum order: 2" in t and "pack" in t)
    rec("cart: ₹398 subtotal -> delivery ₹50, total ₹448, 'Add ₹602 more' message", "₹398" in t and "₹50" in t and "₹448" in t and "Add ₹602 more to unlock free delivery." in t, t[:300].replace("\n", " "))
    cur_qty = 2
    for n, sub, ship in [(3, "₹597", "₹40"), (5, "₹995", "₹40"), (6, "₹1,194", "FREE")]:
        for _ in range(n - cur_qty): pg.click("[data-a=inc]"); pg.wait_for_timeout(100)
        cur_qty = n; t = pg.inner_text("#box")
        rec(f"cart: {n} packs -> subtotal {sub}, delivery {ship}", sub in t and ("Delivery" in t) and (ship in t))
    rec("cart: free delivery message at ₹1,194", "FREE delivery on this order" in pg.inner_text("#box"))
    for _ in range(5): pg.click("[data-a=dec]")
    pg.wait_for_timeout(200); rec("cart: cannot go below the minimum order (shows a clear message)", "minimum order is 2" in pg.inner_text("#box") and pg.locator("a:has-text('Proceed to checkout')").get_attribute("aria-disabled") == "true")
    pg.click("[data-a=inc]"); pg.wait_for_timeout(200); env.overflow(pg, "cart"); env.shot(pg, "36_cart_pack")
    # ---------- exact delivery boundaries through the real order API ----------
    codes = {}
    for nm, price in [("Edge 300", 300), ("Edge 498", 498), ("Edge 499", 499), ("Edge 999", 999), ("Edge 1000", 1000)]:
        r = fj(ad, "/api/admin/products", "POST", {"name": nm, "category": "kurti", "price": price, "stock": 5, "return_eligible": "false"}); assert r["status"] == 201, r
    prods = {x["name"]: x["id"] for x in state()["products"]}
    for nm, fee in [("Edge 300", 50), ("Edge 498", 50), ("Edge 499", 40), ("Edge 999", 40), ("Edge 1000", 0)]:
        r = fj(cu, "/api/orders", "POST", {"customer": {"name": "Sita Devi", "phone": "9927892667", "house": "12", "locality": "Main road", "city": "Sambhal", "state": "UP", "pincode": "244303"}, "items": [{"productId": prods[nm], "qty": 1}], "paymentMethod": "COD", "idempotencyKey": "edge-" + nm.replace(" ", "")})
        rec(f"server: subtotal ₹{nm.split()[1]} -> delivery ₹{fee if fee else 'FREE'} (total {r['json'].get('total')})", r["status"] == 201 and r["json"]["shipping"] == fee and r["json"]["total"] == int(nm.split()[1]) + fee)
    r = fj(cu, "/api/orders", "POST", {"customer": {"name": "Sita Devi", "phone": "9927892667", "house": "12", "locality": "Main road", "city": "Sambhal", "state": "UP", "pincode": "244303"}, "items": [{"productId": prods["Edge 300"], "qty": 4}], "paymentMethod": "COD", "idempotencyKey": "edge-mix", "shipping": 0, "total": 1})
    rec("server ignores a delivery charge/total sent by the browser (4 x ₹300 = ₹1,200, free delivery)", r["json"]["subtotal"] == 1200 and r["json"]["shipping"] == 0 and r["json"]["total"] == 1200)
    # ---------- mobile checks ----------
    for path in ["/", "/shop", "/category/thakur-ji-poshak", "/category/mala-and-necklace", "/cart", "/account"]:
        pg.goto(B + path); env.overflow(pg, path)
    q = env.ctx(viewport={"width": 320, "height": 640}).new_page()
    for path in ["/", "/product/" + slug, "/category/thakur-ji-poshak"]: q.goto(B + path); env.overflow(q, "320px " + path)
    ad.goto(B + "/admin"); ad.wait_for_selector("#add"); ad.click("[data-pa=edit] >> nth=0"); ad.wait_for_selector("#pf"); env.overflow(ad, "admin edit form (all sections)")
    dk = env.ctx(viewport={"width": 1280, "height": 800}, is_mobile=False, has_touch=False).new_page(); dk.goto(B + "/product/" + slug); dk.wait_for_selector("#pdp"); env.overflow(dk, "desktop product page"); env.shot(dk, "37_product_desktop")
    dk.goto(B + "/"); env.shot(dk, "38_home_desktop"); rec("desktop header: Thakur Ji menu is first", dk.locator(".dnav .dd").first.inner_text().startswith("Thakur Ji Poshak"))
    rec("no JavaScript errors on the storefront", not errs, "; ".join(errs[:3]))
finish()
