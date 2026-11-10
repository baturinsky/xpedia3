import { rul, stripPediaMarkup } from './Ruleset';
import { Section } from './Section';


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
    t = stripPediaMarkup(t);
    return t;
  }

  get title() {
    return rul.tr(this._title, { icon: "none" });
  }

}
