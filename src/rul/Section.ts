import { rul } from './Ruleset';
import { Article } from './Article';
import { last } from '../util';

export class Section {
  _articles: Article[] = [];

  articles(ordered = false) {
    return ordered ? rul.sortArticlesByName(this._articles) : this._articles;
  }

  constructor(public id: string, xpediaOwn = false) {
    rul.sections[id] = this;

    if (xpediaOwn) {
      rul.typeSectionsOrder.push(this);
    } else {
      rul.sectionsOrder.push(this);
    }

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
    return [...rul.sectionsOrder, ...rul.orderedTypeSections()]
  }

  nearbySection(delta: number) {
    let as = Section.all();
    let ind = as.indexOf(this);
    let nextInd = (ind + delta + as.length) % as.length;
    return as[nextInd]
  }

  lastArticle(ordered: boolean) {
    return last(this.articles(ordered));
  }

  firstArticle(ordered: boolean) {
    return this.articles(ordered)[0];
  }
}
