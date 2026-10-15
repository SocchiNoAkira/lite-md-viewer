/**
 * toc.ts — 大纲导航（TOC）+ scroll-spy。
 *
 * 从已渲染的 DOM 中提取标题（h1~h3），生成侧栏大纲。
 * 滚动时高亮当前可见章节，点击大纲项平滑滚动到对应标题。
 */

export interface TocItem {
  /** 标题文本。 */
  text: string;
  /** 标题级别（1~3）。 */
  level: number;
  /** 对应标题元素的 id。 */
  id: string;
  /** DOM 元素引用。 */
  element: HTMLElement;
}

/**
 * 从阅读区容器中提取标题，生成 TOC 列表。
 * 依赖 markdown-it-anchor 已给标题加 id。
 */
export function extractToc(container: HTMLElement): TocItem[] {
  const items: TocItem[] = [];
  container.querySelectorAll<HTMLElement>("h1, h2, h3").forEach((el) => {
    // 跳过空的或未生成 id 的标题。
    if (!el.id) return;
    const level = Number(el.tagName[1]);
    items.push({
      text: el.textContent?.trim() ?? "",
      level,
      id: el.id,
      element: el,
    });
  });
  return items;
}

/**
 * 渲染 TOC 到侧栏容器。
 * 返回 (items, 点击处理函数)。
 */
export function renderToc(container: HTMLElement, items: TocItem[]): void {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = '<span class="toc-empty">无标题</span>';
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "toc-list";

  for (const item of items) {
    const li = document.createElement("li");
    li.className = `toc-item toc-level-${item.level}`;
    li.dataset.tocId = item.id;

    const a = document.createElement("a");
    a.href = `#${item.id}`;
    a.textContent = item.text;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      item.element.scrollIntoView({ behavior: "smooth", block: "start" });
      // 手动更新高亮（scroll-spy 会随滚动更新，但立即反馈更佳）。
      highlightTocItem(container, item.id);
    });

    li.appendChild(a);
    ul.appendChild(li);
  }

  container.appendChild(ul);
}

/**
 * 高亮指定 id 的 TOC 项，取消其他高亮。
 */
function highlightTocItem(container: HTMLElement, id: string): void {
  container.querySelectorAll<HTMLElement>(".toc-item").forEach((li) => {
    li.classList.toggle("active", li.dataset.tocId === id);
  });
}

/**
 * scroll-spy：根据滚动位置高亮当前章节。
 *
 * @param container TOC 容器
 * @param items     提取的标题列表
 * @param scrollContainer 滚动的阅读区容器（#reader）
 */
export function setupScrollSpy(
  container: HTMLElement,
  items: TocItem[],
  scrollContainer: HTMLElement
): () => void {
  let ticking = false;

  const update = (): void => {
    ticking = false;

    // 找到当前视口顶部之上最近的标题。
    let currentId: string | null = null;
    const containerTop = scrollContainer.getBoundingClientRect().top;

    for (const item of items) {
      const top = item.element.getBoundingClientRect().top - containerTop;
      if (top <= 40) {
        currentId = item.id;
      } else {
        break;
      }
    }

    if (currentId) {
      highlightTocItem(container, currentId);
    }
  };

  const onScroll = (): void => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  scrollContainer.addEventListener("scroll", onScroll, { passive: true });

  // 返回清理函数。
  return () => {
    scrollContainer.removeEventListener("scroll", onScroll);
  };
}
