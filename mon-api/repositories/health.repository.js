export function createHealthRepository(prisma) {
  return {
    checkDatabase() {
      return prisma.$queryRaw`SELECT 1`;
    },
  };
}
