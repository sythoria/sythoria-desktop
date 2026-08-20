import React from "react";

interface BrandIconProps {
  name: string;
  className?: string;
  size?: number;
  showSparkle?: boolean;
}

export const BrandIcon: React.FC<BrandIconProps> = ({ name, className = "", size = 24, showSparkle = false }) => {
  const iconKey = name.toLowerCase().replace(/[^a-z0-9]/g, "");

  const renderIconSvg = () => {
    switch (iconKey) {
      // 1. GitHub
      case "github":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF" className={className}>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
        );

      // 2. Browser Automation / Playwright / Puppeteer
      case "playwright":
      case "puppeteer":
      case "browser":
      case "webbrowserautomation":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="10" fill="#2D3748" />
            <path
              d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-1 2h2v4h-2V7zm0 6h2v4h-2v-4z"
              fill="#38BDF8"
            />
            <path d="M4.5 12h15M12 4.5v15" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );

      // 3. Notion
      case "notion":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF" className={className}>
            <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.455-.654c1.12-.093 1.214.373 1.026.933l-2.053 8.35c-.373 1.586-.56 2.053-1.866 2.146l-10.707.607c-.933.047-1.306-.327-1.12-.98l1.837-10.868zm3.266 2.333l-1.306 7.699c-.093.42.093.653.606.606l2.146-.14c.467-.046.607-.28.7-.653l1.4-6.812c.093-.42-.047-.653-.513-.607l-3.033.207zm4.292-.28l2.94-.233c.467-.047.84.186.747.653l-1.4 6.812c-.093.42-.373.653-.84.7l-2.94.233c-.466.047-.84-.187-.746-.653l1.4-6.813c.093-.42.373-.653.84-.7z" />
          </svg>
        );

      // 4. Slack
      case "slack":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path
              d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
              fill="#E01E5A"
            />
            <path
              d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
              fill="#36C5F0"
            />
            <path
              d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
              fill="#2EB67D"
            />
            <path
              d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
              fill="#ECB22E"
            />
          </svg>
        );

      // 5. Linear
      case "linear":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="10" fill="#18181B" />
            <path
              d="M4.5 12a7.5 7.5 0 0 0 11.5 6.3L5.7 8A7.47 7.47 0 0 0 4.5 12zm3.3-6.3L18.3 16A7.5 7.5 0 0 0 7.8 5.7z"
              fill="#FFFFFF"
            />
          </svg>
        );

      // 6. Google Drive
      case "googledrive":
      case "gdrive":
        return (
          <svg width={size} height={size * 0.9} viewBox="0 0 87.3 78" className={className}>
            <path
              d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
              fill="#0066DA"
            />
            <path
              d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
              fill="#00AC47"
            />
            <path
              d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
              fill="#EA4335"
            />
            <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
            <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#FFBA00" />
            <path
              d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
              fill="#2684FC"
            />
          </svg>
        );

      // 7. PostgreSQL / Supabase
      case "postgres":
      case "postgresql":
      case "supabase":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="10.5" fill="#336791" />
            <path
              d="M16.8 15.2c-.3-.5-.8-.8-1.4-.9.8-.6 1.3-1.6 1.3-2.7 0-1.9-1.5-3.4-3.4-3.4-.6 0-1.2.2-1.7.5V6.8c0-.4-.3-.8-.8-.8s-.8.3-.8.8v2.4c-.6.5-1 1.2-1.1 2.1-.8.2-1.4.9-1.4 1.8 0 .8.5 1.5 1.2 1.8-.1.4-.1.8 0 1.2.2 1 1 1.8 2 2 .5.1 1.1 0 1.6-.2.4.6 1.1 1 1.9 1 1.3 0 2.4-1.1 2.4-2.4 0-.7-.3-1.3-.8-1.7zm-3.5-5.5c1 0 1.9.8 1.9 1.9s-.8 1.9-1.9 1.9-1.9-.8-1.9-1.9.9-1.9 1.9-1.9z"
              fill="#FFFFFF"
            />
          </svg>
        );

      // 8. Memory Knowledge Graph
      case "memory":
      case "memorygraph":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="11" fill="#4F46E5" />
            <path
              d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
              fill="#A5B4FC"
            />
            <path d="M10.5 9.5L7.5 15.5M13.5 9.5l3 6M8.5 18h7" stroke="#FFFFFF" strokeWidth="1.5" />
          </svg>
        );

      // 9. Tavily Search
      case "tavily":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0D9488" />
            <path
              d="M6 8h12M12 8v10M9 18h6"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 10. Firecrawl Web Scraper
      case "firecrawl":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#EA580C" />
            <path
              d="M12 4c.5 3-2 4.5-2 7 0 2 1.8 3.5 3.5 3.5 2 0 3.5-1.5 3.5-3.5 0-3-3-4.5-2-7 2 1.5 4 4.5 4 7.5a6 6 0 1 1-12 0c0-3.5 2.5-6 5-7.5z"
              fill="#FEF08A"
            />
          </svg>
        );

      // 11. Docker
      case "docker":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#2496ED" className={className}>
            <path d="M13 8h2v2h-2zm-3 0h2v2h-2zm-3 0h2v2H7zm6-3h2v2h-2zm-3 0h2v2h-2zm-3 0h2v2H7zm6 6h2v2h-2zm-3 0h2v2h-2zm-3 0h2v2H7zm14.5 1.5c-.4-.3-1.3-.4-1.9-.3-.1-.6-.4-1.2-.8-1.7l-.6.3c.3.5.5 1 .5 1.6-1.1-.1-2.2.3-2.8 1.1H1c-.5 0-1 .4-1 1 0 4.4 3.6 8 8 8 5.6 0 9.8-4 10.3-9.4.6.1 1.2-.1 1.6-.4.4-.3.6-.8.6-1.2 0-.4-.4-.7-1-.9z" />
          </svg>
        );

      // 12. GitLab
      case "gitlab":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path fill="#E24329" d="M12 20.8l3.6-11H8.4z" />
            <path fill="#FCA326" d="M12 20.8L8.4 9.8H1.8zm0 0l3.6-11h6.6z" />
            <path fill="#E24329" d="M1.8 9.8l-1.3 4c-.2.5 0 1.1.4 1.4L12 20.8z" />
            <path fill="#FC6D26" d="M1.8 9.8h6.6L5.7 1.4c-.2-.6-.9-.6-1.1 0z" />
            <path fill="#E24329" d="M22.2 9.8l1.3 4c.2.5 0 1.1-.4 1.4L12 20.8z" />
            <path fill="#FC6D26" d="M22.2 9.8h-6.6l2.7-8.4c.2-.6.9-.6 1.1 0z" />
          </svg>
        );

      // 13. Sentry
      case "sentry":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path
              fill="#FF3366"
              d="M13.1 3.5c-.7-.9-1.9-.9-2.6 0L2.3 14.3c-.7.9-.2 2.2 1 2.2h17.4c1.2 0 1.7-1.3 1-2.2L13.1 3.5zm-1.1 4l5.8 7.5H6.2l5.8-7.5z"
            />
          </svg>
        );

      // 14. SQLite
      case "sqlite":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0284C7" />
            <path
              d="M7 6h10c.6 0 1 .4 1 1v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1zm0 5h10c.6 0 1 .4 1 1v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1v-2c0-.6.4-1 1-1zm0 5h10c.6 0 1 .4 1 1v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1v-2c0-.6.4-1 1-1z"
              fill="#FFFFFF"
            />
          </svg>
        );

      // 15. Redis
      case "redis":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#DC382D" className={className}>
            <path d="M12 2L2 7l10 5 10-5-10-5zm0 9L2 16l10 5 10-5-10-5z" />
          </svg>
        );

      // 16. MongoDB
      case "mongodb":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#47A248" className={className}>
            <path d="M12 1.5C11.5 3 7 7.5 7 12.5c0 4 3 7 5 9.5 2-2.5 5-5.5 5-9.5 0-5-4.5-9.5-5-11z" />
          </svg>
        );

      // 17. Kubernetes
      case "kubernetes":
      case "k8s":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#326CE5" className={className}>
            <path d="M12 2l8.7 5v10L12 22l-8.7-5V7L12 2zm0 3.2L5.8 8.8v6.4L12 18.8l6.2-3.6V8.8L12 5.2z" />
          </svg>
        );

      // 18. Cloudflare
      case "cloudflare":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#F38020" className={className}>
            <path d="M18.2 10.1c-.5-2.3-2.5-4-4.9-4-2 0-3.8 1.2-4.6 3-.4-.1-.8-.1-1.2-.1-2.5 0-4.5 2-4.5 4.5 0 .3 0 .6.1.9C1.3 14.8 0 16.2 0 18c0 2.2 1.8 4 4 4h14.5c2.5 0 4.5-2 4.5-4.5 0-2.1-1.4-3.9-3.4-4.4-.1-1-.7-2-1.4-3z" />
          </svg>
        );

      // 19. AWS & S3
      case "awss3":
      case "aws":
      case "s3":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#232F3E" />
            <path
              d="M6 14.5c3.5 2 8.5 2 12 0M15.5 13.5l2.5 1-1.5 2"
              stroke="#FF9900"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 20. Local Filesystem
      case "filesystem":
      case "localfilesystem":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0284C7" />
            <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" fill="#FFFFFF" />
          </svg>
        );

      // 21. Jira & Confluence (Atlassian)
      case "jiraconfluence":
      case "jira":
      case "confluence":
      case "atlassian":
      case "atlassianrovo":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#0052CC" className={className}>
            <path d="M11.53 2c0 2.4-1.2 4.4-3.2 5.5l3.2 3.2c2-1.1 3.2-3.1 3.2-5.5 0-1.1-.3-2.2-.8-3.2h-2.4zm.94 10.33l-3.2-3.2c-2 1.1-3.2 3.1-3.2 5.5 0 2.4 1.2 4.4 3.2 5.5l3.2-3.2c-2-1.1-3.2-3.1-3.2-5.5 0-1.1.3-2.2.8-3.2l2.4 4.1z" />
          </svg>
        );

      // 22. Obsidian
      case "obsidian":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#1E1E2E" />
            <path d="M12 3l6 4.5-2 11-8 2.5-4-6.5L12 3z" fill="#7C3AED" />
            <path d="M12 3v15l4-1.5 2-11L12 3z" fill="#9333EA" />
          </svg>
        );

      // 23. Todoist
      case "todoist":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#E44332" />
            <path
              d="M7 8l3 3 7-7M7 13l3 3 7-7M7 18l3 3 7-7"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 24. Trello
      case "trello":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0079BF" />
            <rect width="4.5" height="11" x="5.5" y="6" rx="1.5" fill="#FFFFFF" />
            <rect width="4.5" height="7.5" x="14" y="6" rx="1.5" fill="#FFFFFF" />
          </svg>
        );

      // 25. Asana
      case "asana":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="7.5" r="3.5" fill="#F06A6A" />
            <circle cx="6.5" cy="16.5" r="3.5" fill="#F06A6A" />
            <circle cx="17.5" cy="16.5" r="3.5" fill="#F06A6A" />
          </svg>
        );

      // 26. Airtable
      case "airtable":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path fill="#FCB400" d="M12 4l9.5 5.5-9.5 5.5L2.5 9.5z" />
            <path fill="#18BFFF" d="M12 16.5l9.5-5.5v7l-9.5 4z" />
            <path fill="#FF4F00" d="M2.5 11l9.5 5.5v7l-9.5-4z" />
          </svg>
        );

      // 27. ClickUp
      case "clickup":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path
              d="M5 14.5l3.5-3.5L12 14.5l3.5-3.5L19 14.5"
              fill="none"
              stroke="#7B68EE"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 8.5L12 3l7 5.5"
              fill="none"
              stroke="#FF007A"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 28. Coda
      case "coda":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#F34B22" />
            <path d="M15 8a5 5 0 1 0 0 8" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        );

      // 29. HubSpot
      case "hubspot":
      case "hubspotcrm":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF7A59" className={className}>
            <path d="M17.5 7.5a2.5 2.5 0 0 0-2.3 1.5H12V7.2a2 2 0 1 0-2 0v1.8H9a2.5 2.5 0 1 0 0 2h1v4.8a2 2 0 1 0 2 0V11h3.2a2.5 2.5 0 1 0 2.3-3.5z" />
          </svg>
        );

      // 30. Google Calendar
      case "googlecalendar":
      case "gcalendar":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="5" fill="#FFFFFF" />
            <path d="M1 6C1 3.24 3.24 1 6 1h12c2.76 0 5 2.24 5 5v2H1V6z" fill="#4285F4" />
            <text
              x="12"
              y="18.5"
              fill="#1A73E8"
              fontSize="11"
              fontWeight="800"
              fontFamily="system-ui, -apple-system, sans-serif"
              textAnchor="middle"
            >
              31
            </text>
          </svg>
        );

      // 31. Gmail
      case "gmail":
      case "googlemail":
        return (
          <svg width={size} height={size * 0.8} viewBox="0 0 24 24" className={className}>
            <path
              d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L12 9.573l8.073-6.08c1.618-1.214 3.927-.059 3.927 1.964z"
              fill="#EA4335"
            />
            <path d="M0 6.545v12.821c0 .904.732 1.636 1.636 1.636h3.819V11.73L0 6.545z" fill="#4285F4" />
            <path d="M24 6.545l-5.455 5.185v9.273h3.819c.904 0 1.636-.732 1.636-1.636V6.545z" fill="#34A853" />
            <path d="M18.545 21.002V11.73L12 16.64l6.545 4.362z" fill="#FBBC05" />
          </svg>
        );

      // 32. Outlook
      case "outlook":
      case "outlookcalendar":
      case "microsoftoutlook":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0078D4" />
            <rect width="14" height="11" x="5" y="6.5" rx="2" fill="#FFFFFF" opacity="0.95" />
            <path d="M5 8l7 4.5L19 8" fill="none" stroke="#0078D4" strokeWidth="1.8" />
          </svg>
        );

      // 33. Discord
      case "discord":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#5865F2" className={className}>
            <path d="M20.3 4.4a19.8 19.8 0 00-4.9-1.5.1.1 0 00-.1.1c-.2.4-.4.9-.6 1.3a18.3 18.3 0 00-5.4 0 12.3 12.3 0 00-.6-1.3.1.1 0 00-.1-.1 19.7 19.7 0 00-4.9 1.5.1.1 0 00-.1.1C.6 9.8-.3 15 .1 20.2a.1.1 0 00.1.1 19.9 19.9 0 006 3 .1.1 0 00.1 0c.5-.7.9-1.4 1.2-2.1a.1.1 0 00-.1-.1c-.7-.3-1.3-.6-1.9-1a.1.1 0 010-.2c.1-.1.3-.2.4-.3a14.2 14.2 0 0012.4 0c.1.1.3.2.4.3a.1.1 0 010 .2c-.6.4-1.2.7-1.9 1a.1.1 0 00-.1.1c.4.7.8 1.4 1.2 2.1a.1.1 0 00.1 0 19.8 19.8 0 006-3 .1.1 0 00.1-.1c.5-5.9-.8-11.1-3.6-15.6a.1.1 0 00-.1-.1zM8.5 16.5c-1.2 0-2.2-1.1-2.2-2.5s1-2.5 2.2-2.5 2.2 1.1 2.2 2.5-1 2.5-2.2 2.5zm7 0c-1.2 0-2.2-1.1-2.2-2.5s1-2.5 2.2-2.5 2.2 1.1 2.2 2.5-1 2.5-2.2 2.5z" />
          </svg>
        );

      // 34. Telegram
      case "telegram":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#24A1DE" className={className}>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.9 6.8l-1.7 8c-.1.6-.5.7-1 .4l-2.6-1.9-1.3 1.2c-.1.1-.3.3-.6.3l.2-2.7 4.9-4.4c.2-.2 0-.3-.3-.1l-6.1 3.8-2.6-.8c-.6-.2-.6-.6.1-.9l10.2-3.9c.5-.2.9.1.8.7z" />
          </svg>
        );

      // 35. Microsoft Teams
      case "teams":
      case "microsoftteams":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#464EB8" />
            <circle cx="16" cy="8" r="2.5" fill="#FFFFFF" opacity="0.9" />
            <path d="M13.5 13a4.5 4.5 0 0 1 9 0v2h-9v-2z" fill="#FFFFFF" opacity="0.9" />
            <rect width="11" height="11" x="2.5" y="6.5" rx="3" fill="#5059C9" />
            <text
              x="8"
              y="15"
              fill="#FFFFFF"
              fontSize="9"
              fontWeight="bold"
              fontFamily="sans-serif"
              textAnchor="middle"
            >
              T
            </text>
          </svg>
        );

      // 36. Twilio
      case "twilio":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="10.5" fill="#F22F46" />
            <circle cx="8.5" cy="8.5" r="2" fill="#FFFFFF" />
            <circle cx="15.5" cy="8.5" r="2" fill="#FFFFFF" />
            <circle cx="8.5" cy="15.5" r="2" fill="#FFFFFF" />
            <circle cx="15.5" cy="15.5" r="2" fill="#FFFFFF" />
          </svg>
        );

      // 37. Exa Neural Search
      case "exa":
      case "exametaphor":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#18181B" />
            <path d="M7 7h10M7 12h7M7 17h10" stroke="#A855F7" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        );

      // 38. Brave Search
      case "brave":
      case "bravesearch":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#FB542B" className={className}>
            <path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4zm0 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
          </svg>
        );

      // 39. Perplexity
      case "perplexity":
      case "perplexityresearch":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#1E293B" />
            <path
              d="M12 4v16M4 12h16M6.34 6.34l11.32 11.32M6.34 17.66L17.66 6.34"
              stroke="#22D3EE"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        );

      // 40. ArXiv
      case "arxiv":
      case "arxivacademic":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#B31B1B" />
            <path d="M7 17L12 7l5 10M9 13h6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      // 41. Wikipedia
      case "wikipedia":
      case "wikipediaknowledge":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#F8FAFC" />
            <path
              d="M5 8l3 8 3-8 3 8 3-8"
              fill="none"
              stroke="#0F172A"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 42. Apify
      case "apify":
      case "apifywebscrapers":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#00A65A" />
            <circle cx="12" cy="12" r="5" fill="#FFFFFF" />
          </svg>
        );

      // 43. Fetch Web URLs
      case "fetch":
      case "fetchweburls":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#0284C7" />
            <path
              d="M7 12h10M13 8l4 4-4 4"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

      // 44. Figma
      case "figma":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <path fill="#F24E1E" d="M8 2h4v4H8z" />
            <path fill="#FF7262" d="M12 2h4a4 4 0 010 8h-4z" />
            <path fill="#A259FF" d="M8 6h4v4H8z" />
            <path fill="#1ABCFE" d="M12 10a4 4 0 114 4h-4z" />
            <path fill="#0ACF83" d="M8 10h4v4H8a4 4 0 010-4z" />
            <path fill="#0ACF83" d="M8 14h4v4a4 4 0 01-4-4z" />
          </svg>
        );

      // 45. YouTube
      case "youtube":
      case "youtubetranscripts":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF0000" className={className}>
            <path d="M23.5 6.2c-.3-1-1.1-1.8-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6c-1 .3-1.8 1.1-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8c.3 1 1.1 1.8 2.1 2.1 1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6c1-.3 1.8-1.1 2.1-2.1.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.5V8.5l6.5 3.5-6.5 3.5z" />
          </svg>
        );

      // 46. Spotify
      case "spotify":
      case "spotifyplayer":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#1DB954" className={className}>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.6 14.4c-.2.3-.5.4-.8.2-2.2-1.3-5-1.6-8.3-.9-.4.1-.7-.2-.8-.5-.1-.4.2-.7.5-.8 3.6-.8 6.7-.4 9.2 1.1.3.2.4.6.2.9zm1.2-2.7c-.3.4-.7.5-1.1.3-2.5-1.5-6.3-2-9.3-1.1-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.4-1 7.6-.5 10.5 1.2.4.3.5.7.4 1.1zm.1-2.8c-3-1.8-8-2-10.8-1.1-.5.1-1-.1-1.1-.6-.1-.5.1-1 .6-1.1 3.3-1 8.8-.8 12.3 1.3.4.3.6.8.3 1.2-.3.4-.8.6-1.3.3z" />
          </svg>
        );

      // 47. Wolfram Alpha
      case "wolfram":
      case "wolframalpha":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#FF5722" />
            <path d="M12 4l2.5 5 5 2.5-5 2.5-2.5 5-2.5-5-5-2.5 5-2.5z" fill="#FFFFFF" />
          </svg>
        );

      // 48. Canva
      case "canva":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <circle cx="12" cy="12" r="10.5" fill="#00C4CC" />
            <path
              d="M16 8a4.5 4.5 0 1 0 0 8c2.5 0 4-1.8 4-4s-1.5-4-4-4z"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.2"
            />
          </svg>
        );

      // 49. Fireflies / Granola
      case "firefliesgranola":
      case "fireflies":
      case "granola":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#18181B" />
            <path
              d="M6 7h3v3H6zm0 4.5h3v3H6zm0 4.5h3v3H6zm4.5-9h3v3h-3zm0 4.5h3v3h-3zm0 4.5h3v3h-3zm4.5-9h3v3h-3zm0 4.5h3v3h-3z"
              fill="#F43F5E"
            />
          </svg>
        );

      // 50. Zapier
      case "zapier":
      case "zapierwebhooks":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
            <rect width="22" height="22" x="1" y="1" rx="6" fill="#FF4A00" />
            <path d="M12 5v14M5 12h14M7 7l10 10M7 17L17 7" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        );

      default:
        return (
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={className}
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        );
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      {renderIconSvg()}
      {showSparkle && (
        <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-white shadow-xs flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="#3B82F6">
            <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
          </svg>
        </div>
      )}
    </div>
  );
};
