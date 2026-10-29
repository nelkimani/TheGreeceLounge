# Setting up each device (one Vercel site for all of them)

Open the site ONCE on each device with its code on the end of the address. The browser remembers it.

| Device | Open this once |
|---|---|
| Kitchen + Choma terminal | https://YOUR-SITE.vercel.app/?t=T1 |
| Bar A terminal | https://YOUR-SITE.vercel.app/?t=T2 |
| Bar B terminal | https://YOUR-SITE.vercel.app/?t=T3 |
| Office computer / accountant laptop | https://YOUR-SITE.vercel.app/?t=OFFICE (or just the plain address) |

- After the first visit the "?t=" part disappears from the address; use a normal bookmark / home-screen shortcut.
- Use the same browser on the terminal every day. Clearing that browser's site data forgets the device, and it will show the office email sign-in until the link is opened again.
- To move a device (e.g. T2 becomes T3), open the site with the new code.
- VITE_TERMINAL_CODE in Vercel is now optional; if set, it is only the default for a browser that has never been set up.
- All devices must use the same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: that is what makes stock, orders and payments shared.

## Receipt printer: direct USB printing (one Xprinter XP-80T per terminal)

Each terminal prints straight to its own USB printer from the browser (WebUSB, needs Chrome or Edge and the https site). No print window, no driver dialog: tap Print and the slip comes out and the paper is cut.

Once per terminal:
1. Plug in the printer, power it on, and open the site in Chrome or Edge.
2. Make a payment (or open a bill), and on the receipt screen tap **Connect printer**. Choose "XP-80T" (or the printer-class device) in the list and press Connect. If the list is empty, tap **Show all USB devices**.
3. The status line turns green: "Printer: ...". The browser remembers it; after a restart it reconnects by itself.

If the terminal is a Windows computer, Windows must hand the printer over to the browser first (one time, per printer):
1. Download Zadig from https://zadig.akeo.ie and run it with the printer plugged in.
2. Options > List All Devices. Pick the XP-80T (it may show as "USB Printing Support" or "XP-80T").
3. Set the target driver to **WinUSB** and press Replace Driver.
4. After this, Windows programs (Notepad, Word) can no longer print to that printer; this site can. To undo it: Device Manager > the printer > Uninstall device (tick "delete the driver"), unplug and replug.

If the printer is not connected or stops responding, the Print button falls back to the normal browser print window (see below), so a receipt can always be produced.

Printing only sends the slip to the printer. It never records a payment.

## Fallback: print through the browser print window (80mm USB thermal)

Receipts and interim bills print through the browser at 80mm width (72mm printable area), one slip per print, with no blank pages.

One-time setup on the computer the printer is plugged into (use Chrome or Edge):
1. Install the printer's Windows driver (from the maker's CD or website) so it shows up under Printers & scanners with its real name. The generic "Text Only" driver will not work.
2. In the driver's Printing Preferences, set paper size to 80mm (e.g. "80mm x Receipt" / "80 x 297mm") and turn on auto-cut if the printer has a cutter.
3. Open a receipt and press Print. In the print window choose that printer, set Margins to None, Scale to 100%, and turn Headers and footers off. Chrome remembers these for next time.

Optional, one-tap printing with no print window:
- Set the thermal printer as the Windows default printer.
- Start Chrome with the `--kiosk-printing` flag (add it to the end of the Target in the Chrome shortcut's Properties). The Print button then prints straight away.

Printing only prints. It never records a payment.
