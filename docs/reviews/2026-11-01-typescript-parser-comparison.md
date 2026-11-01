# L4 parser comparison and acceptance contract

Status: comparison measured; Babel is eligible for the bounded pilot. Runtime integration and acceptance are separate checks.
Base: `129c43bdd47ba842d010501ebffea08a3e01602a` (merged L3).
[ROADMAP](../../ROADMAP.md) owns stage status. This record owns the bounded parser
comparison and its measured acceptance evidence; it is not a release approval.

## Pilot contract fixed before measurement

Only `.ts`, `.tsx` and `.jsx` receive syntax and bounded named-declaration extraction.
Keep existing Acorn JS behavior and identities. No typechecking, module/import
resolution, call graph, security/HTTP signals or framework routing is claimed for
the pilot. These files retain an explicit syntax-only partial diagnostic, so strict
installed preflight remains unchanged. `.mts`, `.cts`, ambient `.d.ts`, Vue/Svelte and HTML embedded
scripts remain outside this pilot. Both directions of cross-language resolution
remain disabled. Duplicate/merged declarations must be explicit uncertainty, never
silently selected or merged.

Parser input is checked text and its original byte hash. Output preserves source
identity, ranges, native language kind and producer/version alongside generic display
kind. Positions use the existing 1-based line/UTF-16-column convention; byte offsets
must not be confused with UTF-16 units. Invalid/recovered syntax is not successful
analysis. Tests must cover Unicode/CRLF, valid and broken TS/TSX/JSX, declaration
nesting/ambiguity, no invented semantic edges, live update, and unchanged JS behavior.

The pilot pre-parse cap is **64 KiB per file**; larger safe text remains inventoried
and readable but receives an analysis-limit diagnostic. Traversal stays bounded by
2000 symbols, 100000 AST nodes and depth 256. These post-parse bounds are not a parser
timeout or sandbox. No worker, asynchronous API or service will be introduced here.

## Measurement budgets fixed before results

- Added shipped runtime: at most **3 MiB uncompressed** and **1 MiB gzip**, including
  required license/package metadata. Report the full npm-installed closure separately
  from the actual shipped execution closure; do not equate type-only dependencies
  with loaded runtime modules.
- Existing Node >=22 and macOS/Linux contract remains. No native binaries, target
  install/build scripts, compiler process, tsconfig loading or target execution.
- Corpus: fixed synthetic valid/broken and stress fixtures, plus a pinned public
  `preactjs/signals` source snapshot: regular `.ts/.tsx/.jsx` under `packages/**/src/`,
  excluding tests, ambient `.d.ts` files and files above the pilot cap. Sort paths, admit at
  most 100 files/2 MiB, report every omitted boundary and pin the corpus hash.
- Parse/cache comparison uses three fresh processes per parser on the same ordered
  in-memory source bytes. Cold includes parser module loading and first parse of the
  whole corpus; unchanged includes SHA-256 checks and cache reuse; update edits one
  corpus file and includes rehash plus only its new analysis. Report all samples and
  maxima, not only the best run. This is a parser/cache benchmark, not filesystem or
  server latency. Final integration separately measures one `indexProject` call and
  full `LiveIndex.refresh` (which performs two agreeing scans).
- Reference-machine maxima: cold corpus <=**1500 ms**, unchanged <=**100 ms**,
  one-file update <=**250 ms**, any accepted <=64 KiB single-file parse <=**100 ms**.
  Final live refresh <=**500 ms** on the same bounded real corpus after warm-up.
- Process peak RSS <=**256 MiB** and increase from pre-parser baseline <=**128 MiB**.
  Record Node, host CPU/OS, byte counts and process measurements. These are acceptance
  thresholds for the measured fixtures, not performance guarantees for arbitrary code.
- Include near-cap token-dense and deeply nested inputs. A thrown parser error must
  remain an explicit diagnostic. If a candidate breaches a budget or correctness
  gate, reject it for this pilot or record the unresolved gap; do not silently move
  the threshold after observing results.

## Candidates and results

Pinned candidates: `@babel/parser@7.29.12` (MIT, maintained v7 release, Node >=6)
and `typescript@6.0.3` (Apache-2.0, classic portable Compiler API, Node >=14.17).
This deliberately does not use Babel 8's higher Node floor or TypeScript 7's native
API. Package metadata and API behavior were independently checked against the
[publisher registry](https://registry.npmjs.org/@babel%2fparser/7.29.12),
[TypeScript metadata](https://registry.npmjs.org/typescript/6.0.3),
[Babel parser docs](https://babeljs.io/docs/babel-parser) and
[Microsoft's classic-API guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).

Real corpus pin: [preactjs/signals at `30a797e962c76cc2e623e84f4194a00b9f0c5c8f`](https://github.com/preactjs/signals/tree/30a797e962c76cc2e623e84f4194a00b9f0c5c8f), MIT.
Archive SHA-256: `c3eb096f7f3c326d38c1dfb9dcf4acf8d1e5ad2b1b1ba798da8c7e3b4c0ddbae`.
No dependencies or scripts from this project are installed or run.

Measurement implementation: `scripts/compare-parsers.mjs`, three fresh child
processes per candidate. Child processes isolate benchmark measurements only;
the product stays synchronous. Both parser ASTs are traversed and counted, not
retained in the cache. Cache stores reduced result counts/errors and hashes.
Results are below; no production dependency was added during comparison.
Compare at least two exact portable packages before choosing. TypeScript's classic
Compiler API line must be pinned explicitly; a native successor is not interchangeable.
No dependency is accepted by this initial contract commit.

## Measured comparison

[Exact run values and package hashes](2026-11-01-typescript-parser-results.json)
retain all three process samples. Host: Apple M5, arm64 Darwin 25.6.0,
Node 22.23.4. Real corpus: 51 files (37 TS, 14 TSX), 299,794 bytes, no omitted
eligible paths; SHA-256 `da0a70f7d30eef4c17bbfbd2ef65c44ac16f953432a29c18852a3b883f208743`.
Ten fixed fixtures add LF/CRLF, JSX, invalid syntax, near-64-KiB dense declarations
and deep nesting. No real-corpus syntax errors occurred. Both candidates rejected
the intentionally broken files and threw on extreme nesting; the pilot must turn
that failure into a visible diagnostic, not silently accept a partial AST.

| Candidate | Cold ms (all 3) | Unchanged ms (all 3) | Update ms (all 3) | Max single-file ms | Max peak RSS | Max increase RSS |
|---|---|---|---|---:|---:|---:|
| Babel 7.29.12 | 87.59 / 91.42 / 88.90 | 0.233 / 0.204 / 0.271 | 4.91 / 3.22 / 4.30 | 25.84 | 94,601,216 B | 36,683,776 B |
| TypeScript 6.0.3 | 125.86 / 118.87 / 117.10 | 0.225 / 0.261 / 0.234 | 2.03 / 2.81 / 2.23 | 13.39 | 140,705,792 B | 82,722,816 B |

The update changes the first sorted real source file; it is not a worst-case update
claim. Dense/deep inputs are included in the single-file measurements. Cache timing
is a shared reduced-result harness, not the final index/live implementation. Peak
RSS uses Node's `resourceUsage().maxRSS` in KiB converted to bytes; baseline is RSS
immediately before loading the parser, after reading the corpus.

| Candidate payload | Raw bytes | gzip of concatenated payload bytes | Full npm archive / unpacked |
|---|---:|---:|---:|
| Babel: package.json, lib/index.js, LICENSE | 521,259 | 102,977 | 445,620 / 2,026,387 B |
| TS: package.json, lib/typescript.js, LICENSE.txt, ThirdPartyNoticeText.txt | 9,194,764 | 1,664,425 | 4,515,854 / 24,346,827 B |

The compressed subset value is a deterministic estimate, not a tarball size; final
artifact compressed bytes must be measured separately. Babel's parser JS has no
runtime package imports. Its declared npm closure includes types and two helpers:
4 packages, 770,181 compressed archive bytes and 4,857,913 unpacked bytes. That
closure is required for a normal developer install and is pinned by the lockfile;
only the self-contained parser JS, package metadata and MIT license are proposed
for the runtime artifact. Type declarations, CLI and optional source map are not
part of that execution payload. No vendor source is rewritten. Test the produced
bundle without ancestor Babel/types packages before accepting this trim.

**Disposition:** Babel satisfies the measured size/time/RSS gates and is eligible
for implementation. TypeScript fails both fixed shipped-size thresholds, despite
passing measured timing/RSS gates, so it is rejected for this lightweight pilot.
This does not rank their overall language correctness or type-system capabilities.
Babel remains on its maintained 7.29.12 line to preserve Node >=22 compatibility.
The implementation still needs source-range/declaration/uncertainty regressions,
full index/live timing, actual bundled execution and independent review.
