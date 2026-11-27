const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;

export function createCachedCatalogRepository(repository) {
  const cache = new Map();

  function read(key, load) {
    const now = Date.now();
    const entry = cache.get(key);
    if (entry && entry.expiresAt > now) return entry.value;
    cache.delete(key);

    const pending = Promise.resolve().then(load);
    cache.set(key, { value: pending, expiresAt: now + CACHE_TTL_MS });
    if (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }

    return pending.then(
      (value) => {
        const current = cache.get(key);
        if (current?.value === pending) {
          cache.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + CACHE_TTL_MS });
        }
        return value;
      },
      (error) => {
        if (cache.get(key)?.value === pending) cache.delete(key);
        throw error;
      },
    );
  }

  function invalidate() {
    cache.clear();
  }

  return {
    findCategories() {
      return read("categories", () => repository.findCategories());
    },

    findAllergens() {
      return read("allergens", () => repository.findAllergens());
    },

    findDishesPage(params) {
      return read(`dishes:${JSON.stringify(params)}`, () => repository.findDishesPage(params));
    },

    findDishById(id) {
      return read(`dish:${id}`, () => repository.findDishById(id));
    },

    findCategoryById(id) {
      return repository.findCategoryById(id);
    },

    findAllergensByCodes(codes) {
      return repository.findAllergensByCodes(codes);
    },

    async createDish(...args) {
      const dish = await repository.createDish(...args);
      invalidate();
      return dish;
    },

    async updateDish(...args) {
      const dish = await repository.updateDish(...args);
      invalidate();
      return dish;
    },

    async deleteDish(...args) {
      const result = await repository.deleteDish(...args);
      invalidate();
      return result;
    },

    hasOrderItems(dishId) {
      return repository.hasOrderItems(dishId);
    },

    invalidate,
  };
}
