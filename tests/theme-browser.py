"""The menu's Theme control: System follows the OS, Light and Dark pin the theme,
the choice survives a reload, reaches the help page, and re-renders the canvas."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import open_document_menu, close_popovers, wait_rendered

URL = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
STATE = """()=>({theme:document.documentElement.dataset.theme||'system',dark:document.body.classList.contains('cl-dark'),
  ink:getComputedStyle(document.body).getPropertyValue('--cl-ink').trim(),
  text:[...document.querySelectorAll('#diagram svg text')].map(t=>t.getAttribute('fill')||getComputedStyle(t).fill)[0]||''})"""


def choose(page, name):
    open_document_menu(page)
    page.locator(".cl-menu .cl-theme").get_by_role("button", name=name).click()
    expect(page.locator(".cl-menu .cl-theme").get_by_role("button", name=name)).to_have_attribute("aria-pressed", "true")
    close_popovers(page)
    page.wait_for_timeout(400)
    wait_rendered(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        wait_rendered(page)
        start = page.evaluate(STATE)
        assert start["theme"] == "system" and not start["dark"], start

        # System is pressed by default and has an icon, never a glyph.
        open_document_menu(page)
        group = page.locator(".cl-menu .cl-theme")
        expect(group.get_by_role("button", name="System")).to_have_attribute("aria-pressed", "true")
        assert group.locator("button svg").count() == 3
        close_popovers(page)

        # Dark pins the theme and re-renders the diagram with light ink.
        choose(page, "Dark")
        dark = page.evaluate(STATE)
        assert dark["theme"] == "dark" and dark["dark"], dark
        assert dark["text"] != start["text"], (start, dark)

        # It survives a reload, before any script but theme.js runs.
        page.reload()
        wait_rendered(page)
        assert page.evaluate(STATE)["dark"], "dark theme lost on reload"

        # The help page honours the same choice.
        help_page = context.new_page()
        help_page.goto(URL + "/help.html")
        assert help_page.evaluate("document.documentElement.dataset.theme") == "dark"
        assert help_page.evaluate("getComputedStyle(document.body).backgroundColor") != "rgb(255, 255, 255)"
        help_page.close()

        # Light pins light even when the system is dark.
        page.emulate_media(color_scheme="dark")
        choose(page, "Light")
        light = page.evaluate(STATE)
        assert light["theme"] == "light" and not light["dark"], light

        # System follows the OS again.
        choose(page, "System")
        system = page.evaluate(STATE)
        assert system["theme"] == "system" and system["dark"], system
        page.emulate_media(color_scheme="light")
        page.wait_for_timeout(400)
        assert not page.evaluate(STATE)["dark"]

        # Phone width: the control fits the menu without overflow.
        phone = browser.new_page(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True)
        phone.goto(URL)
        wait_rendered(phone)
        open_document_menu(phone)
        box = phone.evaluate("(()=>{const g=document.querySelector('.cl-menu .cl-theme').getBoundingClientRect(),m=document.querySelector('.cl-menu').getBoundingClientRect();return {g:[g.left,g.right],m:[m.left,m.right]}})()")
        assert box["g"][0] >= box["m"][0] and box["g"][1] <= box["m"][1], box
        heights = phone.evaluate("[...document.querySelectorAll('.cl-menu .cl-theme button')].map(b=>b.getBoundingClientRect().height)")
        assert min(heights) >= 44, heights
        phone.close()
        assert not errors, errors
        print("PASS  theme switcher: system, pinned light/dark, reload, help page, phone")
    finally:
        browser.close()
