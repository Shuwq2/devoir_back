export function createUserRepository(prisma) {
  const toStoredUser = (user) =>
    user && ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: user.password,
    });

  return {
    async findByEmail(email) {
      return toStoredUser(
        await prisma.users.findUnique({ where: { email } }),
      );
    },

    async findById(id) {
      return toStoredUser(
        await prisma.users.findUnique({ where: { id } }),
      );
    },

    async create({ email, name, passwordHash, role }) {
      return toStoredUser(
        await prisma.users.create({
          data: { email, name, password: passwordHash, role },
        }),
      );
    },
  };
}
