import json, sys, urllib.request, urllib.error, re
from playwright.sync_api import sync_playwright
B = "http://localhost:4321"; R = []
def rec(name, ok, note=""):
    R.append((name, bool(ok), note)); print(("PASS " if ok else "FAIL ") + name + (" — " + str(note) if (note and not ok) or (note and len(str(note)) < 80) else ""), flush=True)
def state(): return json.load(urllib.request.urlopen(B + "/__state"))
def get(p):
    try: return urllib.request.urlopen(B + p).read().decode()
    except urllib.error.HTTPError as e: return e.read().decode()      # 404 pages are real pages we want to inspect
def hit(p): urllib.request.urlopen(B + p).read()
def fj(page, path, method="GET", body=None):
    """fetch() from inside the browser page (so cookies / Origin are real)."""
    return page.evaluate("""async ([p,m,b]) => { const r = await fetch(p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); let j={}; try{j=await r.json()}catch(e){} return {status:r.status, json:j}; }""", [path, method, body])
RZP = """window.Razorpay=function(o){this.o=o;this.h={}};Razorpay.prototype.on=function(e,f){this.h[e]=f};
Razorpay.prototype.open=function(){var o=this.o,pay='pay_E2E'+Math.random().toString(36).slice(2,10);fetch('/__sign?order='+o.order_id+'&pay='+pay).then(r=>r.text()).then(function(sig){o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:pay,razorpay_signature:sig})})};"""
MOBILE = dict(viewport={"width": 360, "height": 740}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")
class Env:
    def __init__(self, br): self.br = br
    def ctx(self, **kw):
        c = self.br.new_context(**{**MOBILE, **kw}); c.route("https://checkout.razorpay.com/**", lambda r: r.fulfill(content_type="text/javascript", body=RZP)); return c
    def overflow(self, pg, name):
        w = pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"); rec(f"no horizontal overflow: {name}", w[0] <= w[1], f"scrollWidth={w[0]} viewport={w[1]}")
    def shot(self, pg, n): pg.screenshot(path=f"/tmp/shots/{n}.png")
    def signup(self, email, pw="Password123", name="Test User"):
        c = self.ctx(); pg = c.new_page(); pg.goto(B + "/account"); pg.click("text=Create account")
        pg.fill("input[name=name]", name); pg.fill("input[name=email]", email); pg.fill("input[name=password]", pw); pg.click("#go"); pg.wait_for_selector("text=Log out"); return c, pg
    def owner(self):
        c, pg = self.signup("owner@example.com", "OwnerPass123", "Owner"); hit("/__admin_grant?email=owner@example.com"); return c, pg
def finish():
    bad = [r for r in R if not r[1]]; print(f"\n{len(R)-len(bad)} passed, {len(bad)} failed"); sys.exit(1 if bad else 0)
