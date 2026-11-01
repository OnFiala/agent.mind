# L4 parser comparison and acceptance contract

Status: budgets fixed before measurement; no parser selected or runtime dependency added.
Base: `129c43bdd47ba842d010501ebffea08a3e01602a` (merged L3).
[ROADMAP](../../ROADMAP.md) owns stage status. This record owns the bounded parser
comparison and its measured acceptance evidence; it is not a release approval.

## Pilot contract fixed before measurement

Only `.ts`, `.tsx` and `.jsx` receive syntax and bounded named-declaration extraction.
Keep existing Acorn JS behavior and identities. No typechecking, module/import
resolution, call graph, security/HTTP signals or framework routing is claimed for
the pilot. These files retain an explicit syntax-only partial diagnostic, so strict
installed preflight remains unchanged. `.mts`, `.cts`, Vue/Svelte and HTML embedded
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
  excluding test/test fixtures and files above the pilot cap. Sort paths, admit at
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

Pending exact package metadata, independent primary-source research and measurements.
Compare at least two exact portable packages before choosing. TypeScript's classic
Compiler API line must be pinned explicitly; a native successor is not interchangeable.
No dependency is accepted by this initial contract commit.
