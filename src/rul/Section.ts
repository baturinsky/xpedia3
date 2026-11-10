import { rul } from './Ruleset';
import { Article } from './Article';
import { last } from '../util';

export class Section {
  _articles: Article[] = [];

  articles(alphabetical = false) {
    return alphabetical ? rul.sortArticlesByName(this._articles) : this._articles;
  }

  constructor(public id: string, xpediaOwn = false) {
    rul.sections[id] = this;

    if (xpediaOwn) {
      rul.typeSectionsOrder.push(this);
    } else {
      rul.sectionsOrder.push(this);
    }

    // A section page shows the pack's own article for that id (pedia text and
    // illustration) above the article list. Only fall back to an empty stub
    // when no such article exists.
    Article.create(id, id);
  }

  get title() {
    return rul.tr(this.id);
  }

  add(article: Article) {
    if (!this._articles.includes(article)) this._articles.push(article);
    if (!article.sections.includes(this)) article.sections.push(this);
  }

  static all() {
    return [...rul.sectionsOrder, ...rul.sortedTypeSections()]
  }

  nearbySection(delta: number) {
    let as = Section.all();
    let ind = as.indexOf(this);
    let nextInd = (ind + delta + as.length) % as.length;
    return as[nextInd]
  }

  lastArticle(alphabetical: boolean) {
    return last(this.articles(alphabetical));
  }

  firstArticle(alphabetical: boolean) {
    return this.articles(alphabetical)[0];
  }
}
