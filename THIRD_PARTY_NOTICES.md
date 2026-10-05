# Third-Party Notices

This notice applies to RogueSave version 0.4.4.

## Bundled code and assets

RogueSave 0.4.4 is implemented with browser Web APIs and Node.js built-in modules. It does not bundle third-party JavaScript packages or PokéRogue application code. It includes two unmodified Rotom images and an unmodified egg icon atlas from the PokéRogue asset repository, hand-written pixel-style SVG icons, and Fusion Pixel Font (12px proportional Simplified Chinese, release 2026.09.25, SIL Open Font License 1.1). Font copyright and license notices are included in `sidepanel/assets/fonts/OFL.txt` and `sidepanel/assets/fonts/LICENSES/`.

Rotom asset source: `pagefaultgames/pokerogue-assets`, commit `056a1f408f26a3be4fef243f7462cb43608c7928`, files `images/pokemon/icons/4/479.png` and `images/pokemon/479.png`. These are provided by the PokéRogue project and its asset contributors; original Pokémon character rights belong to their respective owners. The upstream README declares CC-BY-NC-SA-4.0 for licensable and applicable assets unless otherwise noted, with REUSE exceptions. Original assets marked LicenseRef-FAIR-USE do not convey a re-license of the original rights. Relevant upstream license and fair-use explanation texts are retained in `sidepanel/assets/licenses/`; their inclusion is not an independent character or trademark authorization. These images must not be blanket-licensed as MIT or public domain. Provenance and publication limitations are documented in `docs/ASSETS.md`.

Egg atlas source: `pagefaultgames/pokerogue-assets`, commit `909b43612324622608023b3beb2f24f4ef159c1d`, file `images/egg/egg_icons.png`, stored locally as `sidepanel/assets/egg-icons.png`. CSS displays the first frame without modifying the PNG. No matching exception was found in the source root/images REUSE annotations; the upstream README's CC-BY-NC-SA-4.0 statement applies to the extent licensable and applicable, subject to the same third-party rights limitations above.

## PokéRogue interoperability reference

RogueSave interoperates with the separately hosted PokéRogue web application and refers to its runtime save interfaces for compatibility. PokéRogue application code is not included in this distribution; the decorative assets listed above are included separately.

- Project: PokéRogue
- Upstream repository: <https://github.com/pagefaultgames/pokerogue>
- Upstream license: GNU Affero General Public License v3.0 (`AGPL-3.0`), as declared by the upstream project

The upstream project's license and notices apply to PokéRogue itself. This notice does not change the license of either project and does not imply endorsement or affiliation.

## Names and trademarks

Pokémon and related names and marks belong to their respective owners. “PokéRogue” is used only to identify the application with which RogueSave interoperates. RogueSave is an unofficial, independent utility and is not endorsed by or affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., Pagefault Games, or the PokéRogue project.
