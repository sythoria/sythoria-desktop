# Mission: Build AI Messenger UI, Navigation, and Real-Time Chat

1. [Project_Reviewer] Review the entire project structure and existing architecture before coding.
   - Read `@AGENTS.md` first and follow all project rules/conventions.
   - Analyze routing, state management, components, backend structure, and chat flow.
   - Create a detailed implementation checklist before making changes.
   - Identify missing abstractions, duplicated logic, and navigation inconsistencies.

2. [Logic_Architect] Implement the Rust WebSocket handler for real-time messaging.
   - Ensure scalable connection/session management.
   - Handle reconnects, message broadcasting, typing events, and error states.
   - Structure backend events for clean frontend synchronization.
   - Keep architecture modular and production-ready.

3. [UI_Specialist] Build and improve the React chat interface with Glassmorphism UI.
   - Implement responsive layout and smooth animations.

   - Add ability to hide/show the sidebar containing chats.

   - Add navigation improvements:
     - When user is inside Settings, provide a clear button to return Home.
     - When creating a new chat from Settings, automatically switch/select the newly created chat.

   - Ensure seamless mobile + desktop usability.# Mission: Build AI Messenger UI and Auth
     1. [Logic_Architect] Implement the Rust WebSocket handler for real-time chat.

     2. [UI_Specialist] Build the main chat interface using React + Glassmorphism.

     3. [Code_Auditor] Refactor both modules to ensure seamless state management.

     # Mission: Build AI Messenger UI and Auth
     1. [Logic_Architect] Implement the Rust WebSocket handler for real-time chat.

     2. [UI_Specialist] Build the main chat interface using React + Glassmorphism.

     3. [Code_Auditor] Refactor both modules to ensure seamless state management.

   - Maintain clean component separation.

4. [State_Manager] Refactor frontend state handling.
   - Ensure chat selection updates globally and consistently.
   - Synchronize sidebar state, routing state, settings state, and active chat state.
   - Prevent stale UI after chat creation/navigation.
   - Optimize React rendering and state flow.

5. [Code_Auditor] Review and refactor all modified modules.
   - Verify frontend/backend integration consistency.
   - Ensure clean architecture and maintainability.
   - Remove duplicated logic and dead code.
   - Validate type safety and error handling.
   - Ensure all new features work together seamlessly.

6. [Task_Coordinator] Delegate tasks to the correct agents based on responsibilities.
   - Ensure agents do not overlap responsibilities unnecessarily.
   - Maintain implementation order:
     1. Project review + checklist
     2. Architecture planning
     3. Backend WebSocket logic
     4. UI implementation
     5. State synchronization
     6. Final audit/refactor
