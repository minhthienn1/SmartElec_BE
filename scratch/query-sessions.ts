import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.chatSession.findMany({
    include: {
      user: true,
      technician: true
    }
  });
  console.log(JSON.stringify(sessions, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
