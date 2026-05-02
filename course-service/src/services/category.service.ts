import { Category, ICategory } from '../models/category.model';
import { Course } from '../models/course.model';

const MAX_CATEGORY_DEPTH = 4;

interface CategoryNode {
  _id: string;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  parentId: string | null;
  children: CategoryNode[];
  createdAt: Date;
  updatedAt: Date;
}

class CategoryService {
  public async createCategory(data: {
    name: string;
    description?: string;
    sortOrder?: number;
    parentId?: string | null;
    createdBy: string;
  }): Promise<ICategory> {
    const normalizedName = data.name.trim();

    const parent = await this.validateParent(data.parentId);

    const existing = await Category.findOne({
      name: { $regex: `^${this.escapeRegex(normalizedName)}$`, $options: 'i' },
      parentId: parent?._id ?? null,
    });

    if (existing) {
      throw new Error('Danh mục này đã tồn tại trong cùng cấp.');
    }

    const category = new Category({
      name: normalizedName,
      description: data.description?.trim() || '',
      sortOrder: data.sortOrder ?? 0,
      parentId: parent?._id ?? null,
      createdBy: data.createdBy,
    });

    await category.save();
    return category;
  }

  public async getPublicCategories(): Promise<CategoryNode[]> {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    return this.buildTree(categories);
  }

  public async getAdminCategories(): Promise<CategoryNode[]> {
    const categories = await Category.find()
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    return this.buildTree(categories);
  }

  public async updateCategory(
    categoryId: string,
    data: { name?: string; description?: string; sortOrder?: number; isActive?: boolean; parentId?: string | null }
  ): Promise<ICategory> {
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new Error('Danh mục không tồn tại.');
    }

    const nextParentId = data.parentId !== undefined ? data.parentId : category.parentId?.toString() ?? null;
    const parent = await this.validateParent(nextParentId, categoryId, categoryId);

    if (data.parentId !== undefined) {
      category.parentId = parent?._id ?? null;
    }

    if (data.name !== undefined) {
      const normalizedName = data.name.trim();
      const duplicate = await Category.findOne({
        _id: { $ne: categoryId },
        name: { $regex: `^${this.escapeRegex(normalizedName)}$`, $options: 'i' },
        parentId: parent?._id ?? null,
      });

      if (duplicate) {
        throw new Error('Tên danh mục đã được sử dụng trong cùng cấp.');
      }

      category.name = normalizedName;
    }

    if (data.description !== undefined) category.description = data.description.trim();
    if (data.sortOrder !== undefined) category.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) category.isActive = data.isActive;

    await category.save();
    return category;
  }

  public async setCategoryStatus(categoryId: string, isActive: boolean): Promise<ICategory> {
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new Error('Danh mục không tồn tại.');
    }

    category.isActive = isActive;
    await category.save();
    return category;
  }

  public async deleteCategory(categoryId: string): Promise<void> {
    const [categoryExists, hasChildren, hasCourses] = await Promise.all([
      Category.exists({ _id: categoryId }),
      Category.exists({ parentId: categoryId }),
      Course.exists({ categoryId: categoryId })
    ]);

    if (!categoryExists) {
      throw new Error('Danh mục không tồn tại.');
    }
    if (hasChildren) {
      throw new Error('Không thể xóa danh mục đang có danh mục con.');
    }
    if (hasCourses) {
      throw new Error('Không thể xóa danh mục đang có khóa học.');
    }

    await Category.deleteOne({ _id: categoryId });
  }

  public async resolveActiveCategorySlug(slug: string): Promise<ICategory> {
    const category = await Category.findOne({ slug, isActive: true });
    if (!category) {
      throw new Error('Danh mục không hợp lệ hoặc đã bị vô hiệu hóa.');
    }
    return category;
  }

  public async resolveCategorySlug(slug: string): Promise<ICategory | null> {
    return Category.findOne({ slug });
  }

  public async resolveActiveCategoryById(categoryId: string): Promise<ICategory> {
    const category = await Category.findOne({ _id: categoryId, isActive: true });
    if (!category) {
      throw new Error('Danh mục không hợp lệ hoặc đã bị vô hiệu hóa.');
    }
    return category;
  }

  public async getDescendantAndSelfIds(categoryId: string): Promise<string[]> {
    const categories = await Category.find().select('_id parentId').lean();
    const childrenMap = new Map<string, string[]>();

    for (const category of categories) {
      if (!category.parentId) continue;
      const parentId = category.parentId.toString();
      const childId = category._id.toString();
      const children = childrenMap.get(parentId) || [];
      children.push(childId);
      childrenMap.set(parentId, children);
    }

    const collected = new Set<string>();
    const stack = [categoryId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (collected.has(currentId)) continue;
      collected.add(currentId);

      for (const childId of childrenMap.get(currentId) || []) {
        stack.push(childId);
      }
    }

    return Array.from(collected);
  }

  private async validateParent(
    parentId?: string | null,
    currentCategoryId?: string,
    movingCategoryId?: string
  ): Promise<ICategory | null> {
    if (parentId === undefined || parentId === null || parentId === '') {
      if (movingCategoryId) {
        await this.ensureDepthLimit(null, movingCategoryId);
      }
      return null;
    }

    if (currentCategoryId && parentId === currentCategoryId) {
      throw new Error('Danh mục không thể là cha của chính nó.');
    }

    const parent = await Category.findById(parentId);
    if (!parent) {
      throw new Error('Danh mục cha không tồn tại.');
    }

    if (currentCategoryId) {
      let cursor: ICategory | null = parent;
      while (cursor) {
        if (cursor._id.toString() === currentCategoryId) {
          throw new Error('Không thể gán danh mục con làm danh mục cha.');
        }

        if (!cursor.parentId) break;
        cursor = await Category.findById(cursor.parentId);
      }
    }

    await this.ensureDepthLimit(parent, movingCategoryId);

    return parent;
  }

  private async ensureDepthLimit(parent: ICategory | null, movingCategoryId?: string): Promise<void> {
    const parentDepth = await this.getCategoryDepth(parent);
    const subtreeHeight = movingCategoryId ? await this.getSubtreeHeight(movingCategoryId) : 1;

    if (parentDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
      throw new Error(`Danh mục chỉ được phép sâu tối đa ${MAX_CATEGORY_DEPTH} cấp.`);
    }
  }

  private async getCategoryDepth(category: ICategory | null): Promise<number> {
    let depth = 0;
    let cursor = category;

    while (cursor) {
      depth += 1;
      cursor = cursor.parentId ? await Category.findById(cursor.parentId) : null;
    }

    return depth;
  }

  private async getSubtreeHeight(categoryId: string): Promise<number> {
    const categories = await Category.find().select('_id parentId').lean();
    const childrenMap = new Map<string, string[]>();

    for (const category of categories) {
      if (!category.parentId) continue;
      const parentId = category.parentId.toString();
      const childId = category._id.toString();
      const children = childrenMap.get(parentId) || [];
      children.push(childId);
      childrenMap.set(parentId, children);
    }

    const measure = (currentId: string): number => {
      const children = childrenMap.get(currentId) || [];
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map((childId) => measure(childId)));
    };

    return measure(categoryId);
  }

  private buildTree(
    categories: Array<{
      _id: any;
      name: string;
      slug: string;
      description: string;
      isActive: boolean;
      sortOrder: number;
      parentId?: any;
      createdAt: Date;
      updatedAt: Date;
    }>
  ): CategoryNode[] {
    const nodeMap = new Map<string, CategoryNode>();

    for (const category of categories) {
      const id = category._id.toString();
      nodeMap.set(id, {
        _id: id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        parentId: category.parentId ? category.parentId.toString() : null,
        children: [],
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      });
    }

    const roots: CategoryNode[] = [];

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: CategoryNode[]) => {
      nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      for (const node of nodes) sortNodes(node.children);
    };

    sortNodes(roots);
    return roots;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default new CategoryService();
