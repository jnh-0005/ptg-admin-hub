/**
 * Split out of calc.js on purpose. PublicCatalog (the public storefront)
 * only ever needs this one constant — not the ~1,300 lines of admin pricing
 * logic around it — but every admin page also imports from calc.js, so
 * Rollup hoists calc.js into one chunk shared by both. Importing
 * DEPOSIT_RATIO from calc.js there meant a storefront shopper's browser had
 * to download that entire ~180 KB chunk for a single number. calc.js
 * re-exports this so every existing admin import keeps working unchanged.
 */
export const DEPOSIT_RATIO = 0.5;
