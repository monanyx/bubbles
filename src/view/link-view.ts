import type { LinkGeometry } from '../geometry/link-path';
import type { Link } from '../model/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class LinkView {
  readonly group: SVGGElement;
  private readonly paths: SVGPathElement[];
  private lastPath = '';
  mid = { x: 0, y: 0 };

  constructor(readonly link: Link) {
    this.group = document.createElementNS(SVG_NS, 'g');
    this.group.setAttribute('class', 'link');
    this.group.dataset.linkId = link.id;
    this.paths = ['link-hit', 'link-core', 'link-glow'].map((cls) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', cls);
      this.group.append(path);
      return path;
    });
  }

  setGeometry(geometry: LinkGeometry): void {
    this.mid = geometry.mid;
    if (geometry.path === this.lastPath) return;
    this.lastPath = geometry.path;
    this.group.style.display = geometry.visible ? '' : 'none';
    for (const path of this.paths) path.setAttribute('d', geometry.path);
  }

  setSelected(selected: boolean): void {
    this.group.classList.toggle('is-selected', selected);
  }
}
