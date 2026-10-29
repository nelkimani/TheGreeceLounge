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

## Receipt printer (80mm USB thermal)

Receipts and interim bills print through the browser at 80mm width (72mm printable area), one slip per print, with no blank pages.

One-time setup on the computer the printer is plugged into (use Chrome or Edge):
1. Install the printer's Windows driver (from the maker's CD or website) so it shows up under Printers & scanners with its real name. The generic "Text Only" driver will not work.
2. In the driver's Printing Preferences, set paper size to 80mm (e.g. "80mm x Receipt" / "80 x 297mm") and turn on auto-cut if the printer has a cutter.
3. Open a receipt and press Print. In the print window choose that printer, set Margins to None, Scale to 100%, and turn Headers and footers off. Chrome remembers these for next time.

Optional, one-tap printing with no print window:
- Set the thermal printer as the Windows default printer.
- Start Chrome with the `--kiosk-printing` flag (add it to the end of the Target in the Chrome shortcut's Properties). The Print button then prints straight away.

Printing only prints. It never records a payment.
