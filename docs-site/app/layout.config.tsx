import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-bold text-lg">
        🧠 MemoryRouter
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
