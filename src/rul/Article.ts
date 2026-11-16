import { rul, stripPediaMarkup } from './Ruleset';
import { Section } from './Section';
import { xpediaVersion } from '../util';

/**
 * A `${...}` placeholder in an article body, see `Article.text`.
 *
 * The `$` is what keeps this apart from the game's own markup: an article may
 * contain `{NEWLINE}` or another `{...}` token, which is markup and is removed,
 * while only the dollar-prefixed form stands for text to insert.
 */
const placeholder = /\$\{([^{}]+)\}/g;

/**
 * The text a `${...}` placeholder stands for, or `undefined` when it is not one.
 *
 * Leaving unknown ids to the markup stripper matters because packs mistype
 * markup into this shape: XPiratez writes `${NEWLINE}` for `{NEWLINE}` in one
 * place and XFiles writes `${ALT}` for `{ALT}`. Neither is a string id, and
 * inventing a readable label for them would print "NEWLINE" where the author
 * meant a line break. The caller drops the `$` and leaves the `{...}`, which the
 * stripper then handles exactly as it did before placeholders existed.
 */
function placeholderText(id: string): string | undefined {
  // The version is not a language string but the number this build prints
  // beside XPedia's name, so it is taken from the same place that label is. An
  // article must not disagree with the navbar about which build it belongs to.
  if (id == "xpediaVersion")
    return xpediaVersion();

  // Anything else has to be a real string in the selected language. `rul.lang`
  // is already the merged table for that language, so this is the same lookup
  // the rest of the pedia does, not a second translation path.
  //
  // Only plain strings are used: a value can be a number, and OXCE plural forms
  // are objects (`STR_DAY: { one: ..., other: ... }`), neither of which belongs
  // inside a sentence. Those fall through as an unknown id.
  let value = rul.lang[id];
  return typeof value == "string" ? value : undefined;
}

export class Article {
  id: string;
  image_id?: string;
  type_id?: string;
  _text?: string;
  _title: string;
  sections: Section[] = [];
  requires?: string[];

  get section() {
    return this.sections[0]?.id;
  }

  static create(id: string, section: string) {
    if (rul.sections[section] == null) {
      new Section(section, true);
    }

    if (id in rul.articles) {
      let article = rul.articles[id];
      // A section page shows its own article as a header (pedia text and
      // illustration), not as a link inside its own list, so never add it there
      if (section && id != section && !article.sections.find(s => s.id == section)) {
        article.addToSection(section);
        rul.sections[section].add(article);
      }
      return article;
    }
    return new Article({ id, section });
  }

  constructor(raw: { id: string, section: string, text?: string, title?: string, image_id?: string, requires?: any }) {
    this.id = raw.id;
    this._text = raw.text;
    this._title = raw.title || raw.id;
    this.image_id = raw.image_id;
    if (raw.requires)
      this.requires = Array.isArray(raw.requires) ? raw.requires : [raw.requires];

    rul.articles[this.id] = this;

    let id = raw.id;

    rul.articles[id] = this;

    if (raw.section) {
      this.addToSection(raw.section);
    }
  }

  addToSection(sectionId: string) {
    let section: Section;
    //if(sectionId == "SOLDIER_BONUSES")      debugger
    if (sectionId in rul.sections) section = rul.sections[sectionId];
    else section = rul.sections[sectionId] = new Section(sectionId);

    if (this.id != section.id) section.add(this);

    if (!this.sections.includes(section))
      this.sections.push(section);

    return section;
  }

  get text() {
    let t = rul.lang[this._text ?? ''] || rul.lang[this.id + "_UFOPEDIA"] || rul.lang[rul.research[this.id]?.lookup as string];
    // Before the markup, not after: `stripPediaMarkup` deletes every `{...}`
    // token, and the braces are part of a placeholder, so expanding afterwards
    // would leave only a stray `$` behind. Doing it here also means every reader
    // of the body sees the same expanded text: the page, an exported copy of it,
    // and anything else that prints `article.text`.
    if (t != null && t.indexOf("${") != -1)
      t = t.replace(placeholder, (match, id: string) => placeholderText(id.trim()) ?? match.substring(1));
    t = stripPediaMarkup(t);
    return t;
  }

  get title() {
    return rul.tr(this._title, { icon: "none" });
  }

}
