# Account export fonts

Locally embedded, unmodified Noto fonts; no personal data or rendering requests
leave the server. Copyright belongs to the Noto Project Authors. Distributed
under SIL Open Font License 1.1; see the adjacent OFL files.

- NotoSans-Regular.ttf and NotoSansArabic-Regular.ttf:
  https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf
- NotoEmoji-Regular.ttf: monochrome Noto Emoji variable font, downloaded from
  https://github.com/google/fonts/blob/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf
  (renamed locally; otherwise unchanged).
- NotoSansCJKsc-Regular.otf:
  https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/SimplifiedChinese

Fetched 2026-11-19. The renderer subsets embedded fonts. Symbols outside these
fonts are explicitly labelled with their Unicode code points, not silently
removed. JSON preserves every original character. Font/layout changes require
a new presentation version; old email retries must retain their pinned version.

The account PDF uses the existing app's Barlow Regular body and Barlow Condensed
Bold headings, copied unchanged from @expo-google-fonts/barlow and
@expo-google-fonts/barlow-condensed. Creator: Jeremy Tribby and the Barlow Project
Authors. SIL OFL 1.1 licences: OFL-Barlow.txt and OFL-BarlowCondensed.txt.
Noto remains the multilingual/emoji fallback. This dark card layout is part of
the unreleased version 2 presentation, not a change to a deployed email version.
