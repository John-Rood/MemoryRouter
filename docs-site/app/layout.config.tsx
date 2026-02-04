import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="flex items-center gap-2 font-bold text-lg">
        <Image src="/logo.png" alt="MemoryRouter" width={28} height={28} />
        MemoryRouter
      </span>
    ),
  },
  links: [
    {
      text: 'Documentation',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'Dashboard',
      url: 'https://app.memoryrouter.ai',
    },
    {
      text: 'Home',
      url: 'https://memoryrouter.ai',
    },
  ],
  githubUrl: 'https://github.com/John-Rood/memoryrouter',
};
