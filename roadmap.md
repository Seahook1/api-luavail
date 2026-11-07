# Admin moderation
- [ ] Secure verified-email admin role and non-bypassable hosting suspension.
- [ ] Admin login and all-script review, disable, restore, and deletion controls.
- [ ] Security tests and live verification; verified admin login may require account confirmation.

# Protection and CDN-style delivery
- [x] Strengthen portable Lua protection with scattered ciphertext and independent integrity checks.
- [x] Add same-domain CDN-style loader and payload links without bypassing licensing or caching private payloads.
- [x] Test Lua execution, tamper rejection, delivery aliases, and the live handshake (26 tests passed; real keyless delivery verified).
- [ ] Verify signed-in dashboard copy and Roblox execution; requesting user has no matching account session, and Roblox is unavailable here.