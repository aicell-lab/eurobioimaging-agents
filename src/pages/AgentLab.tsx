import React, { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { debounce } from 'lodash';
import { ThebeProvider, useThebe } from '../components/chat/ThebeProvider';
import '../styles/ansi.css';
import '../styles/notebook.css';
import { useHyphaStore } from '../store/hyphaStore';
import { CellManager, SavedState } from './CellManager';
// Add styles for the active cell
import '../styles/notebook.css';
import { loadModelSettings } from '../utils/modelSettings';
import { CanvasPanel, HyphaCoreWindow } from '../components/notebook/CanvasPanel';
import { ChatMessage } from '../utils/chatCompletion';
import { v4 as uuidv4 } from 'uuid';
import ModelSettingsCanvasContent from '../components/notebook/ModelSettingsCanvasContent';
import EditAgentCanvasContent, { EditAgentFormData } from '../components/notebook/EditAgentCanvasContent';


// Import components
import NotebookHeader from '../components/notebook/NotebookHeader';
import NotebookContent from '../components/notebook/NotebookContent';
import NotebookFooter from '../components/notebook/NotebookFooter';
import KeyboardShortcutsDialog from '../components/notebook/KeyboardShortcutsDialog';
import WelcomeScreen from '../components/notebook/WelcomeScreen';
import { AgentConfigData } from '../components/notebook/AgentConfigDialog';

// Import utilities and types
import { NotebookCell, NotebookData, NotebookMetadata, CellType, CellRole } from '../types/notebook';
import { showToast, dismissToast } from '../utils/notebookUtils';

// Import hooks
import { useChatCompletion } from '../hooks/useChatCompletion';
import { useNotebookCommands } from '../hooks/useNotebookCommands';
import { useNotebookInitialization } from '../hooks/useNotebookInitialization';
import { useUrlSync } from '../hooks/useUrlSync';
import { useNotebookKeyboardShortcuts } from '../hooks/useNotebookKeyboardShortcuts';

// Add imports for Sidebar components
import Sidebar from '../components/notebook/Sidebar';

// Import types from ProjectsProvider and use BaseProject alias
import type { Project as BaseProject, ProjectFile } from '../providers/ProjectsProvider';
import { ProjectsProvider, useProjects, IN_BROWSER_PROJECT } from '../providers/ProjectsProvider'; // Import constant

// Import setupNotebookService
import { setupNotebookService } from '../components/services/hyphaCoreServices';
import { SITE_ID } from '../utils/env';

// Import the hook's return type
import { InitialUrlParams } from '../hooks/useNotebookInitialization';

// Import AgentConfigForm and ModelConfigForm as default exports
import { ThebeTerminalPanel } from '../components/chat/ThebeStatus'; // Import the refactored component

// Add CellRole enum values
const CELL_ROLES = {
  THINKING: 'thinking' as CellRole,
  SYSTEM: 'system' as CellRole,
  USER: 'user' as CellRole,
  ASSISTANT: 'assistant' as CellRole
};

const defaultNotebookMetadata: NotebookMetadata = {
  modified: new Date().toISOString(),
  kernelspec: {
    name: 'python3',
    display_name: 'Python 3'
  },
  language_info: {
    name: 'python',
    version: '3.9'
  },
  title: 'Untitled Chat',
  created: new Date().toISOString(),
  filePath: undefined, // Ensure defaults are undefined
  projectId: undefined
};

// Define additional types
interface ProjectManifest {
  name: string;
  description: string;
  version: string;
  type: string;
  created_at: string;
  filePath?: string;
}

// Extend the base Project type
interface Project extends BaseProject {
  manifest: ProjectManifest;
}

// We've moved EditAgentCanvasContent to its own file

const NotebookPage: React.FC = () => {
  const navigate = useNavigate();
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [executionCounter, setExecutionCounter] = useState(1);
  const { isReady, executeCode, restartKernel, status: kernelStatus, interruptKernel, kernelInfo, kernel } = useThebe();
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const hasInitialized = useRef(false); // Tracks if the initial load effect has completed
  const systemCellsExecutedRef = useRef(false);
  const [notebookMetadata, setNotebookMetadata] = useState<NotebookMetadata>(defaultNotebookMetadata);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const editorRefs = useRef<{ [key: string]: React.RefObject<any> }>({});
  const lastUserCellRef = useRef<string | null>(null);
  const lastAgentCellRef = useRef<string | null>(null);
  const { server, isLoggedIn, artifactManager } = useHyphaStore();
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [isAIReady, setIsAIReady] = useState(false);
  const [agentSettings, setAgentSettings] = useState(() => loadModelSettings());
  const [hyphaCoreApi, setHyphaCoreApi] = useState<any>(null);
  const {
    selectedProject,
    setSelectedProject,
    getFileContent,
    uploadFile,
    getInBrowserProject,
    saveInBrowserFile,
    getInBrowserFileContent,
    isLoading: isProjectsLoading,
    initialLoadComplete,
    projects,
  } = useProjects();

  // === New State ===
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [parsedUrlParams, setParsedUrlParams] = useState<InitialUrlParams | null>(null);
  // === End New State ===

  // Get projects list for the initialization hook
  const { projects: projectsFromHook } = useProjects();

  const [canvasPanelWidth, setCanvasPanelWidth] = useState(600);
  const [showCanvasPanel, setShowCanvasPanel] = useState(false);
  const [hyphaCoreWindows, setHyphaCoreWindows] = useState<HyphaCoreWindow[]>([]);
  const [activeCanvasTab, setActiveCanvasTab] = useState<string | null>(null);
  
  // Track screen size for responsive behavior
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  
  // Initialize the cell manager
  const cellManager = useRef<CellManager | null>(null);

  // Simplified sidebar state - open by default on welcome screen
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Ref to store the AbortController for Hypha service setup
  const hyphaServiceAbortControllerRef = useRef<AbortController>(new AbortController());

  // Add the keyboard shortcuts hook
  useNotebookKeyboardShortcuts({
    cellManager: cellManager.current,
    isEditing
  });

  // === New State ===
  const [showEditAgentAfterLoad, setShowEditAgentAfterLoad] = useState(false);
  // === End New State ===

  // --- Define handleAddWindow callback ---
  const handleAddWindow = useCallback((config: any) => {
    // Prevent adding duplicate window IDs
    setHyphaCoreWindows(prev => {
      if (prev.some(win => win.id === config.window_id)) {
        return prev; // Already exists, do nothing
      }
      const newWindow: HyphaCoreWindow = {
        id: config.window_id,
        src: config.src,
        name: config.name || `${config.src || 'Untitled Window'}`
      };
      return [...prev, newWindow];
    });
    // Optionally, activate the new window/tab and show the panel
    setActiveCanvasTab(config.window_id);
    setShowCanvasPanel(true);
  }, [setHyphaCoreWindows, setActiveCanvasTab, setShowCanvasPanel]); // Dependencies for the callback

  if (!cellManager.current) {
    cellManager.current = new CellManager(
      cells,
      setCells,
      activeCellId,
      setActiveCellId,
      executionCounter,
      setExecutionCounter,
      editorRefs,
      notebookMetadata,
      lastAgentCellRef,
      executeCode,
    );
  } else {
    // Update the references when they change
    cellManager.current.cells = cells;
    cellManager.current.activeCellId = activeCellId;
    cellManager.current.executionCounter = executionCounter;
    cellManager.current.notebookMetadata = notebookMetadata;
    cellManager.current.executeCodeFn = executeCode;
  }

  // Function to get conversation history up to a specific cell
  const getConversationHistory = useCallback((upToCellId?: string): ChatMessage[] => {
    let relevantCells = cells;
    if (upToCellId) {
      const cellIndex = cells.findIndex(cell => cell.id === upToCellId);
      if (cellIndex !== -1) {
        relevantCells = cells.slice(0, cellIndex + 1);
      }
    }
    return cellManager.current?.convertCellsToHistory(relevantCells).map(msg => ({
      ...msg,
      role: msg.role as any
    })) || [];
  }, [cells]);

  // Handle executing code
  const handleExecuteCode = useCallback(async (completionId: string, code: string, cellId?: string): Promise<string> => {
    let actualCellId = cellId;
    try {
      const manager = cellManager.current;
      if (!manager) {
        console.error('CellManager not initialized in handleExecuteCode');
        return "Error: CellManager not available";
      }

      if (actualCellId) {
        const existingCell = manager.findCell(c => c.id === actualCellId);
        if (!existingCell) {
          console.error('Cell not found:', actualCellId);
          return `[Cell Id: ${actualCellId}]\n Runtime Error: cell not found`;
        }
        manager.updateCellContent(actualCellId, code);
      }
      else {
        actualCellId = manager.addCell(
          'code',
          code,
          'assistant',
          manager.getCurrentAgentCell() || undefined,
          lastUserCellRef.current || undefined,
          undefined,
          completionId
        ) || '';
        manager.setActiveCell(actualCellId);
        manager.setCurrentAgentCell(actualCellId);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      return await manager.executeCell(actualCellId, true) || '';
    } catch (error) {
      console.error("Fatal error in handleExecuteCode:", error);
      return `Fatal error: ${error instanceof Error ? error.message : String(error)}`;
    }
    finally {
      if (actualCellId) {
        cellManager.current?.collapseCodeCell(actualCellId);
      }
    }
  }, [executeCode]);

  // --- Core Notebook Loading & Saving Functions ---
  const loadNotebookContent = useCallback(async (projectId: string | undefined, filePath: string) => {
    const loadingToastId = 'loading-notebook';
    showToast('Loading notebook...', 'loading', { id: loadingToastId });

    try {
      let rawContent: string | NotebookData;
      let resolvedProjectId = projectId || IN_BROWSER_PROJECT.id;

      setHyphaCoreApi(null);

      if (resolvedProjectId === IN_BROWSER_PROJECT.id) {
        rawContent = await getInBrowserFileContent(filePath);
      } else {
        if (isProjectsLoading || !initialLoadComplete) {
          console.warn('[AgentLab] Load file cancelled: Projects provider not ready for remote project.', resolvedProjectId);
          showToast('Projects are still loading, please try again shortly.', 'warning');
          dismissToast(loadingToastId);
          return;
        }
        rawContent = await getFileContent(resolvedProjectId, filePath);
      }

      const notebookData: NotebookData = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;

      if (notebookData && typeof notebookData === 'object') {
        const loadedCells = notebookData.cells || [];

        // We no longer load model settings from notebook metadata
        // Model settings are stored in localStorage

        setNotebookMetadata(prev => ({
          ...defaultNotebookMetadata,
          ...(notebookData.metadata || {}),
          title: notebookData.metadata?.title || filePath.split('/').pop() || 'Untitled Chat',
          modified: new Date().toISOString(),
          filePath: filePath,
          projectId: resolvedProjectId,
          // Ensure there's always an agentArtifact property
          agentArtifact: notebookData.metadata?.agentArtifact || {
            id: '', // Empty ID indicates it's a new agent
            name: notebookData.metadata?.title || filePath.split('/').pop() || 'Untitled Chat',
            description: 'An agent created from chat',
            version: '0.1.0',
            manifest: {
              name: notebookData.metadata?.title || filePath.split('/').pop() || 'Untitled Chat',
              description: 'An agent created from chat',
              version: '0.1.0',
              license: 'CC-BY-4.0',
              welcomeMessage: 'Hi, how can I help you today?',
              type: 'agent',
              created_at: new Date().toISOString()
            }
          }
        }));

        // --- Explicitly update URL params after successful load using new names ---
        const paramsToSet: Record<string, string> = { file: filePath };
        // Only add project if it's not the 'in-browser' one
        if (resolvedProjectId !== IN_BROWSER_PROJECT.id) {
          paramsToSet.project = resolvedProjectId;
        }
        // --- End URL update ---

        const visibleCells = loadedCells.filter(cell => cell.metadata?.role !== CELL_ROLES.THINKING);
        setCells(visibleCells);

        let maxExecutionCount = 0;
        visibleCells.forEach((cell: NotebookCell) => {
          const count = cell.executionCount;
          if (typeof count === 'number' && isFinite(count) && count > maxExecutionCount) {
            maxExecutionCount = count;
          }
        });
        setExecutionCounter(maxExecutionCount + 1);

        const userCells = visibleCells.filter(cell => cell.role === CELL_ROLES.USER);
        const assistantCells = visibleCells.filter(cell => cell.role === CELL_ROLES.ASSISTANT);
        lastUserCellRef.current = userCells[userCells.length - 1]?.id || null;
        lastAgentCellRef.current = assistantCells[assistantCells.length - 1]?.id || null;
        cellManager.current?.clearRunningState();
        setShowWelcomeScreen(false);
        setupService();
        showToast('Notebook loaded successfully', 'success');
      } else {
        console.warn('Invalid notebook file format found after parsing:', { projectId: resolvedProjectId, filePath });
        throw new Error('Invalid notebook file format');
      }
    } catch (error) {
      console.error('Error loading file content:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`Failed to load notebook: ${errorMessage}`, 'error');
      setCells([]);
      setNotebookMetadata(defaultNotebookMetadata);
      setExecutionCounter(1);
      lastUserCellRef.current = null;
      lastAgentCellRef.current = null;
      setSelectedProject(null);
    } finally {
      dismissToast(loadingToastId);
    }
  }, [
    isProjectsLoading,
    initialLoadComplete,
    getFileContent,
    getInBrowserFileContent,
    showToast,
    dismissToast,
    setNotebookMetadata,
    setCells,
    setExecutionCounter,
    setSelectedProject,
    setAgentSettings,
  ]);

  // Add useEffect to hide address bar on mobile devices
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    const hideAddressBar = () => {
      if (!isMobile) return;
      
      // For iOS devices
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // Scroll after a delay to ensure content is ready
        setTimeout(() => {
          // First scroll to 0 to ensure we're at the top
          window.scrollTo(0, 0);
          // Then scroll down 1px to hide address bar
          window.scrollTo(0, 1);
          
          // If that didn't work (newer iOS), try window height
          if (document.documentElement.scrollHeight > window.innerHeight) {
            window.scrollTo(0, window.innerHeight / 5);
          }
        }, 300);
      } 
      // For Android devices
      else if (/Android/i.test(navigator.userAgent)) {
        setTimeout(() => {
          window.scrollTo(0, 1);
        }, 300);
      }
    };

    // Hide address bar on page load
    if (isMobile) {
      // Set up a timed function to repeatedly attempt to hide the address bar
      // This helps on some mobile browsers that restore it after initial load
      hideAddressBar();
      
      // Try multiple times as some browsers restore it
      const timerId = setInterval(hideAddressBar, 1000);
      setTimeout(() => clearInterval(timerId), 3000); // Stop trying after 3 seconds
    }
    
    // Hide when orientation changes
    window.addEventListener('orientationchange', hideAddressBar);
    
    // Re-hide when window is resized
    window.addEventListener('resize', hideAddressBar);
    
    // Re-hide on interaction - helps on some browsers
    if (isMobile) {
      document.addEventListener('touchstart', hideAddressBar, {once: true});
    }
    
    return () => {
      window.removeEventListener('orientationchange', hideAddressBar);
      window.removeEventListener('resize', hideAddressBar);
      document.removeEventListener('touchstart', hideAddressBar);
    };
  }, []);

  const handleRestartKernel = useCallback(async () => {
    if (!cellManager.current) return;
    showToast('Restarting kernel...', 'loading');
    try {
      cellManager.current?.clearRunningState();

      // Abort any ongoing Hypha service operations before restarting
      hyphaServiceAbortControllerRef.current.abort('Kernel restart initiated');
      hyphaServiceAbortControllerRef.current = new AbortController(); // Create new one

      // Clear the hyphaCoreApi state to trigger re-initialization after restart
      setHyphaCoreApi(null);

      await restartKernel();
      setExecutionCounter(1);
      systemCellsExecutedRef.current = false;
      setTimeout(() => {
        setupService();
        showToast('Kernel restarted successfully', 'success');
      }, 100);
    } catch (error) {
      console.error('Failed to restart kernel:', error);
      showToast('Failed to restart kernel', 'error');
    }
  }, [restartKernel, setExecutionCounter, setHyphaCoreApi]);

  // --- Kernel State Reset Function ---
  const handleResetKernelState = useCallback(async () => {
    if (!isReady) {
      // If kernel isn't ready, perform a full restart
      console.warn('Kernel not ready, performing full restart instead of reset.');
      await handleRestartKernel();
      return;
    }

    if (!cellManager.current) return;

    showToast('Resetting kernel state...', 'loading');
    try {
      // Abort any ongoing Hypha service operations before resetting
      hyphaServiceAbortControllerRef.current.abort('Kernel reset initiated');
      hyphaServiceAbortControllerRef.current = new AbortController(); // Create new one

      // Execute the reset command
      await executeCode('%reset -f');

      // Reset execution counter and system cell flag
      setExecutionCounter(1);
      systemCellsExecutedRef.current = false;

      // Reset the hyphaCoreApi state to trigger re-initialization
      setHyphaCoreApi(null); // This will trigger the setup useEffect again
      setupService();
      showToast('Kernel state reset successfully', 'success');
      // Keep AI ready state as true, kernel is still technically ready
      // setIsAIReady(true);
    } catch (error) {
      console.error('Failed to reset kernel state:', error);
      showToast('Failed to reset kernel state', 'error');
      // Consider if AI should be marked as not ready on reset failure
      // setIsAIReady(false);
    }
  }, [isReady, executeCode, setExecutionCounter, showToast, handleRestartKernel]); // Added dependencies

  // Add createNotebookFromAgentTemplate function
  const createNotebookFromAgentTemplate = useCallback(async (agentId: string, projectId?: string) => {
    if (!artifactManager || !isLoggedIn) {
      showToast('You need to be logged in to create a notebook from an agent template', 'error');
      return;
    }

    const loadingToastId = 'creating-notebook';
    showToast('Creating notebook from agent template...', 'loading', { id: loadingToastId });

    try {
      // Get the agent artifact
      const agent = await artifactManager.read({ artifact_id: agentId, _rkwargs: true });
      if (!agent || !agent.manifest) {
        throw new Error('Agent not found or invalid manifest');
      }

      // Get template from manifest
      const template = agent.manifest.chat_template || {};

      // Generate a new filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = `${agent.manifest.name}_${timestamp}.ipynb`;
      const resolvedProjectId = projectId || IN_BROWSER_PROJECT.id;

      // Prepare cells array
      let cells = [];

      // If template has cells, use them
      if (template.cells && template.cells.length > 0) {
        console.log('[AgentLab] Using cells from agent chat template');
        cells = template.cells;
      }
      // Otherwise, create a system cell with the agent's startup script
      else if (agent.manifest.startup_script) {
        console.log('[AgentLab] Creating system cell with agent startup script');
        const systemCellContent = agent.manifest.startup_script;
        cells.push({
          id: uuidv4(),
          type: 'code',
          content: systemCellContent,
          executionState: 'idle',
          metadata: {
            trusted: true,
            role: 'system'
          },
          executionCount: undefined,
          output: []
        });

        // Add a welcome message cell if available
        if (agent.manifest.welcomeMessage) {
          console.log('[AgentLab] Adding welcome message cell');
          cells.push({
            id: uuidv4(),
            type: 'markdown',
            content: agent.manifest.welcomeMessage,
            executionState: 'idle',
            metadata: {
              trusted: true,
              role: 'assistant'
            },
            executionCount: undefined,
            output: []
          });
        }
      }

      // Create notebook data from template
      const notebookData: NotebookData = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          ...defaultNotebookMetadata,
          // Only include non-model settings from template metadata
          ...(template.metadata ? {
            title: template.metadata.title,
            description: template.metadata.description,
            // Exclude modelSettings
          } : {}),
          title: agent.manifest.name || 'Agent Chat',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          filePath: filePath,
          projectId: resolvedProjectId,
          agentArtifact: {
            id: agent.id,
            version: agent.version,
            name: agent.manifest.name,
            description: agent.manifest.description,
            manifest: {
              ...agent.manifest,
              // Don't include modelConfig in the notebook metadata
            }
          }
        },
        cells: cells
      };

      // Save the notebook
      if (resolvedProjectId === IN_BROWSER_PROJECT.id) {
        await saveInBrowserFile(filePath, notebookData);
        setSelectedProject(getInBrowserProject());
      } else {
        const blob = new Blob([JSON.stringify(notebookData, null, 2)], { type: 'application/json' });
        const file = new File([blob], filePath.split('/').pop() || 'notebook.ipynb', { type: 'application/json' });
        await uploadFile(resolvedProjectId, file);
      }

      // Load the newly created notebook
      await loadNotebookContent(resolvedProjectId, filePath);
      showToast('Notebook created successfully', 'success');
      dismissToast(loadingToastId);
      // Reset kernel state after loading
      // await handleResetKernelState();

    } catch (error) {
      console.error('Error creating notebook from agent template:', error);
      showToast(`Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      dismissToast(loadingToastId);
    }
  }, [
    artifactManager,
    isLoggedIn,
    saveInBrowserFile,
    uploadFile,
    loadNotebookContent,
    setSelectedProject,
    getInBrowserProject,
    handleResetKernelState
  ]);

  // Initialization Hook - Now returns the correct ref type
  const { hasInitialized: initRefObject, initialUrlParams } = useNotebookInitialization({
    isLoggedIn,
    initialLoadComplete,
    setSelectedProject,
    getInBrowserProject,
    setNotebookMetadata,
    setCells,
    setExecutionCounter,
    defaultNotebookMetadata,
    cellManagerRef: cellManager,
    projects,
  });

  // Store parsed params once initialization is done and set welcome screen visibility
  useEffect(() => {
    if (initRefObject.current && initialUrlParams) {
      setParsedUrlParams(initialUrlParams);
      
      // Handle file URL parameter
      if (initialUrlParams.filePath) {
        // Automatically load the file without showing the welcome screen
        console.log(`[AgentLab] File URL parameter detected, loading: ${initialUrlParams.filePath}`);
        const projectId = initialUrlParams.projectId || IN_BROWSER_PROJECT.id;
        loadNotebookContent(projectId, initialUrlParams.filePath)
          .then(() => {
            console.log(`[AgentLab] Successfully loaded file from URL parameter: ${initialUrlParams.filePath}`);
            setShowWelcomeScreen(false);
          })
          .catch(error => {
            console.error(`[AgentLab] Error loading file from URL parameter:`, error);
            // Fall back to showing welcome screen with the file parameter
            setShowWelcomeScreen(true);
          });
        return; // Early return to avoid other welcome screen logic
      }
      
      // Only show welcome screen if we don't have a filePath parameter
      const shouldShowWelcome = !initialUrlParams.filePath;
      setShowWelcomeScreen(shouldShowWelcome);
      // If we have an edit parameter, we'll handle it in the welcome screen
      // This ensures the edit button is visible and clickable
      if (initialUrlParams.edit) {
        console.log('[AgentLab] Edit parameter detected:', initialUrlParams.edit);
      }
    }
  }, [initRefObject.current, initialUrlParams, loadNotebookContent]); // Added loadNotebookContent to dependencies

  // Notebook Commands Hook
  const { handleCommand } = useNotebookCommands({
    cellManager: cellManager.current,
    hasInitialized: initRefObject // Use the ref object directly
  });

  // Use the chat completion hook (Moved down, needs handleExecuteCode)
  const {
    isProcessingAgentResponse,
    activeAbortController,
    handleSendChatMessage,
    handleRegenerateClick,
    handleStopChatCompletion,
    setInitializationError: setChatInitializationError
  } = useChatCompletion({
    cellManager: cellManager.current,
    executeCode: handleExecuteCode, // Needs definition before this
    agentSettings,
    getConversationHistory,
    isReady,
    setCells
  });

  // Modify handleAbortExecution to use the ref
  const handleAbortExecution = useCallback(() => {
    console.log('[AgentLab] Aborting Hypha Core service operations...');
    // Abort the current controller
    hyphaServiceAbortControllerRef.current.abort();
    console.log(`[AgentLab] Abort signal sent. Reason: ${hyphaServiceAbortControllerRef.current.signal.reason}`);

    // Create a new controller for future operations
    hyphaServiceAbortControllerRef.current = new AbortController();
    console.log('[AgentLab] New AbortController created for subsequent operations.');

    // Additionally, stop any ongoing chat completion if needed (assuming different mechanism)
    handleStopChatCompletion();

  }, [handleStopChatCompletion]); // Dependency on handleStopChatCompletion if it's used


  // Save notebook based on current notebookMetadata
  const saveNotebook = useCallback(async () => {
    if (!cellManager.current) {
      console.warn('Save Cancelled: CellManager not available.');
      return;
    }
    if (isProjectsLoading && notebookMetadata.projectId && notebookMetadata.projectId !== IN_BROWSER_PROJECT.id) {
      console.warn('Save Cancelled: Projects provider is still loading for remote save.');
      showToast('Projects are still loading, please wait before saving.', 'warning');
      return;
    }

    let currentFilePath = notebookMetadata.filePath;
    if (!currentFilePath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      currentFilePath = `Untitled_Chat_${timestamp}.ipynb`;
      setNotebookMetadata(prev => ({
        ...prev,
        filePath: currentFilePath,
        projectId: prev.projectId || IN_BROWSER_PROJECT.id,
        modified: new Date().toISOString()
      }));
    }

    const metadataToSave: NotebookMetadata = {
      ...(cellManager.current.notebookMetadata),
      filePath: currentFilePath,
      modified: new Date().toISOString(),
    };
    const resolvedProjectId = metadataToSave.projectId || IN_BROWSER_PROJECT.id;

    if (!metadataToSave.filePath) {
        console.error('Save Failed: File path is still missing.');
        showToast('Cannot determine save file path.', 'error');
      return;
    }

    console.log('[AgentLab Save] Attempting save to:', { projectId: resolvedProjectId, filePath: metadataToSave.filePath });
    showToast('Saving...', 'loading');

    try {
      setNotebookMetadata(metadataToSave);
      const notebookData: NotebookData = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: metadataToSave,
        cells: cellManager.current.getCurrentCellsContent()
      };

      if (resolvedProjectId === IN_BROWSER_PROJECT.id) {
        await saveInBrowserFile(metadataToSave.filePath, notebookData);
      } else {
        console.log(`[AgentLab Save] Saving to remote project: ${resolvedProjectId}`);
        const blob = new Blob([JSON.stringify(notebookData, null, 2)], { type: 'application/json' });
        const file = new File([blob], metadataToSave.filePath.split('/').pop() || 'notebook.ipynb', { type: 'application/json' });
        await uploadFile(resolvedProjectId, file);
      }
      showToast('Notebook saved successfully', 'success');
    } catch (error) {
      console.error('Error saving notebook:', error);
      showToast(`Failed to save notebook: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [cellManager, notebookMetadata, isProjectsLoading, uploadFile, saveInBrowserFile, setNotebookMetadata]);

  // Handle loading notebook from file input (header upload button)
  const loadNotebookFromFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const loadedNotebookData: NotebookData = JSON.parse(content);
        const newFilePath = `${file.name}`;
        // We no longer load model settings from notebook metadata
        // Model settings are stored in localStorage

        const metadata: NotebookMetadata = {
          ...defaultNotebookMetadata,
          ...(loadedNotebookData.metadata || {}),
          title: loadedNotebookData.metadata?.title || file.name.replace('.ipynb', '') || 'Uploaded Chat',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          projectId: IN_BROWSER_PROJECT.id,
          filePath: newFilePath
        };
        setNotebookMetadata(metadata);
        const cellsToLoad = loadedNotebookData.cells?.filter((cell: NotebookCell) => cell.metadata?.role !== CELL_ROLES.THINKING) || [];
        setCells(cellsToLoad);
        let maxExecutionCount = 0;
        cellsToLoad.forEach((cell: NotebookCell) => {
          const count = cell.executionCount;
          if (typeof count === 'number' && isFinite(count) && count > maxExecutionCount) {
            maxExecutionCount = count;
          }
        });
        setExecutionCounter(maxExecutionCount + 1);
        lastUserCellRef.current = null;
        lastAgentCellRef.current = null;
        setActiveCellId(null);
        setSelectedProject(getInBrowserProject());
        const notebookToSave: NotebookData = {
          nbformat: 4,
          nbformat_minor: 5,
          metadata: metadata,
          cells: cellsToLoad
        };
        await saveInBrowserFile(newFilePath, notebookToSave)
          .then(() => console.log(`Saved uploaded file to in-browser: ${newFilePath}`))
          .catch(err => console.error(`Failed to auto-save uploaded file: ${err}`));

        // Make sure project context is updated after loading from file
        setSelectedProject(getInBrowserProject());

        // Reset kernel state after loading and saving
        // await handleRestartKernel(); // Use reset instead
        await handleResetKernelState();

      } catch (error) {
        console.error('Error loading notebook from file:', error);
        showToast('Failed to load notebook file', 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }, [saveInBrowserFile, setSelectedProject, getInBrowserProject, handleResetKernelState, setAgentSettings]);

  // --- Cell Action Handlers (Passed down to NotebookContent) ---
  const handleActiveCellChange = useCallback((id: string) => cellManager.current?.setActiveCell(id), []);
  const handleExecuteCell = useCallback((id: string): Promise<string> => {
    return cellManager.current?.executeCell(id, true) || Promise.resolve('Error: CellManager not ready');
  }, []);
  const handleUpdateCellContent = useCallback((id: string, content: string) => cellManager.current?.updateCellContent(id, content), []);

  // Update handleToggleCellEditing to track editing state
  const handleToggleCellEditing = useCallback((id: string, editing: boolean) => {
    setIsEditing(editing);
    cellManager.current?.toggleCellEditing(id, editing);
  }, []);

  const handleToggleCodeVisibility = useCallback((id: string) => cellManager.current?.toggleCodeVisibility(id), []);
  const handleToggleOutputVisibility = useCallback((id: string) => cellManager.current?.toggleOutputVisibility(id), []);
  const handleCellTypeChange = useCallback((id: string, cellType: CellType) => {
    cellManager.current?.changeCellType(id, cellType);
  }, []);
  const handleUpdateCellRole = useCallback((id: string, role: CellRole) => {
    cellManager.current?.updateCellRole(id, role);
  }, []);
  const handleDeleteCell = useCallback((id: string) => cellManager.current?.deleteCell(id), []);
  const handleDeleteCellWithChildren = useCallback((id: string) => cellManager.current?.deleteCellWithChildren(id), []);
  const handleToggleCellCommitStatus = useCallback((id: string) => cellManager.current?.toggleCellCommitStatus(id), []);
  // Add definitions for missing handlers
  const handleAddCodeCell = useCallback(() => {
    cellManager.current?.addCell('code', '', 'user', activeCellId || undefined);
  }, [activeCellId]);
  const handleAddMarkdownCell = useCallback(() => {
    cellManager.current?.addCell('markdown', '', 'user', activeCellId || undefined);
  }, [activeCellId]);
  const getEditorRef = useCallback((cellId: string) => {
    if (!editorRefs.current[cellId]) {
      editorRefs.current[cellId] = React.createRef();
    }
    return editorRefs.current[cellId];
  }, []);

  // --- Canvas Panel Handlers ---
  const handleCanvasPanelResize = useCallback((newWidth: number) => {
    // Only used for external components that might need to know the width
    // Don't update width directly for small screens
    if (!isSmallScreen) {
      setCanvasPanelWidth(newWidth);
    }
  }, [isSmallScreen]);

  const toggleCanvasPanel = useCallback(() => {
    setShowCanvasPanel(prev => !prev);
  }, []);

  const handleTabClose = useCallback((tabId: string) => {
    setHyphaCoreWindows(prev => prev.filter(win => win.id !== tabId));
    
    // If no windows are left, close the panel
    if (hyphaCoreWindows.length <= 1) {
      setShowCanvasPanel(false);
    }
  }, [hyphaCoreWindows.length]);

  // Callback passed to Sidebar to handle loading a selected notebook
  const handleLoadNotebook = useCallback(async (project: Project, file: ProjectFile) => {
      if (selectedProject?.id !== project.id) {
          setSelectedProject(project);
      }
      await loadNotebookContent(project.id, file.path);
      // Reset kernel state after loading is complete
      // await handleRestartKernel(); // Use reset instead
      await handleResetKernelState();

      // Update dependency array
  }, [loadNotebookContent, setSelectedProject, selectedProject?.id, handleResetKernelState]);

  // --- Effect to check screen size and adjust canvas panel ---
  useEffect(() => {
    const checkScreenSize = () => {
      const small = window.innerWidth <= 480;
      setIsSmallScreen(small);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // --- Effect to handle canvas panel on small screens ---
  useEffect(() => {
    // If screen size changes to small while canvas is open
    if (isSmallScreen && showCanvasPanel && hyphaCoreWindows.length === 0) {
      // Close canvas panel if no windows
      setShowCanvasPanel(false);
    }
  }, [isSmallScreen, showCanvasPanel, hyphaCoreWindows.length]);

  // URL Sync Hook
  useUrlSync({
    notebookMetadata,
    // Use initRefObject.current directly
    hasInitialized: !showWelcomeScreen && initRefObject.current,
  });

  // Run system cells on startup (Adjusted)
  useEffect(() => {
    const executeSystemCell = async () => {
      // Use initRefObject.current directly
      if (showWelcomeScreen || !isReady || !initRefObject.current || systemCellsExecutedRef.current) return;
      const systemCell = cells.find(cell => cell.metadata?.role === CELL_ROLES.SYSTEM && cell.type === 'code');
      if (!systemCell) {
        systemCellsExecutedRef.current = true;
        return;
      }
      const systemCellId = systemCell.id;

      // --- Set the flag BEFORE the async operation that updates state ---
      systemCellsExecutedRef.current = true;

      try {
        // Now execute the cell
        await cellManager.current?.executeCell(systemCellId, true);
        // Hide output/code after execution completes
        cellManager.current?.hideCellOutput(systemCellId);
        cellManager.current?.hideCode(systemCellId);
      } catch (error) {
        console.error('Error executing system cell:', error); // Keep error
        // Attempt to show output on error
        cellManager.current?.showCellOutput(systemCellId);
        cellManager.current?.hideCode(systemCellId);
        // Optional: Reset flag on error if you want to retry?
        // systemCellsExecutedRef.current = false;
      }
    };
    executeSystemCell();
  }, [showWelcomeScreen, isReady, cells, initRefObject.current, cellManager]); // Depend on showWelcomeScreen & ref current value

  // New hook to set AI readiness based on kernel readiness
  useEffect(() => {
    if (isReady) {
      console.log('[AgentLab] Kernel is ready, setting AI ready state to true.');
      setIsAIReady(true);
    } else {
      console.log('[AgentLab] Kernel is not ready, setting AI ready state to false.');
      setIsAIReady(false);
    }
  }, [isReady, setIsAIReady]); // Dependency array ensures this runs when isReady changes

  // Load agent settings from localStorage on component mount
  useEffect(() => {
    const settings = loadModelSettings();
    console.log('[AgentLab] Loading agent settings from localStorage.', settings);
    setAgentSettings(settings);
  }, []);

  // Calculate the filename from the filePath in metadata
  const notebookFileName = useMemo(() => {
    if (!notebookMetadata.filePath) {
      return ''; // Default if no path
    }
    // Get the part after the last '/'
    const parts = notebookMetadata.filePath.split('/');
    return parts[parts.length - 1] || 'Untitled_Chat'; // Fallback if split fails unexpectedly
  }, [notebookMetadata.filePath]); // Recalculate only when filePath changes

  // --- Notebook Action Handlers ---
  const handleDownloadNotebook = useCallback(() => {
    if (!notebookMetadata) return;
    const notebookToSave: NotebookData = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: notebookMetadata,
      cells: cellManager.current?.getCurrentCellsContent() || cells,
    };
    const blob = new Blob([JSON.stringify(notebookToSave, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = notebookFileName.endsWith('.ipynb') ? notebookFileName : `${notebookFileName}.ipynb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [notebookMetadata, cells, notebookFileName]);

  const handleRunAllCells = useCallback(async () => {
    if (!cellManager.current) return;
    await cellManager.current.runAllCells();
    showToast('Finished running all cells', 'success');
  }, []);

  const handleClearAllOutputs = useCallback(() => {
    if (!cellManager.current) return;
    cellManager.current.clearAllOutputs();
    showToast('Cleared all outputs', 'success');
  }, []);

  // Add keyboard shortcut for saving notebook
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (showWelcomeScreen) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        console.log('Ctrl/Cmd+S detected, attempting to save notebook...');
        saveNotebook();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [saveNotebook, showWelcomeScreen]); // Depend on showWelcomeScreen

  const setupService = useCallback(async () => {
    setHyphaCoreApi(null);
    if(!server || !executeCode) {
      showToast('Hypha Core Service is not available, please login.', 'warning');
      return;
    }
    console.log('[AgentLab] Setting up Hypha Core service for notebook:', notebookMetadata.filePath);
    const currentSignal = hyphaServiceAbortControllerRef.current.signal;
    try {
      const api = await setupNotebookService({
        onAddWindow: handleAddWindow,
        server, executeCode, agentSettings,
        abortSignal: currentSignal
      });
      if (currentSignal.aborted) {
          console.log('[AgentLab] Hypha Core service setup aborted before completion.');
          return;
      }
      setHyphaCoreApi(api);
      console.log('[AgentLab] Hypha Core service successfully set up.');
      showToast('Hypha Core Service Connected', 'success');
    } catch (error: any) {
      if (error.name === 'AbortError') {
          console.log('[AgentLab] Hypha Core service setup explicitly aborted.');
      } else {
          console.error('[AgentLab] Failed to set up notebook service:', error);
          showToast(`Failed to connect Hypha Core Service: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
      setHyphaCoreApi(null);
    }
  }, [handleAddWindow, server, executeCode, agentSettings, notebookMetadata.filePath]);

  // Get system cell for publish dialog (Now used for canvas edit/publish)
  const systemCell = useMemo(() => {
    return cells.find(cell => cell.metadata?.role === CELL_ROLES.SYSTEM && cell.type === 'code') || null;
  }, [cells]);

  // Add handlers for moving cells up and down
  const handleMoveCellUp = useCallback(() => {
    if (!activeCellId || !cellManager.current) return;
    cellManager.current.moveCellUp(activeCellId);
    cellManager.current.scrollCellIntoView(activeCellId);
  }, [activeCellId]);

  const handleMoveCellDown = useCallback(() => {
    if (!activeCellId || !cellManager.current) return;
    cellManager.current.moveCellDown(activeCellId);
    cellManager.current.scrollCellIntoView(activeCellId);
  }, [activeCellId]);

  // Add canMoveUp and canMoveDown calculations
  const canMoveUp = useMemo(() => {
    if (!activeCellId || !cellManager.current) return false;
    const cellIndex = cells.findIndex(cell => cell.id === activeCellId);
    return cellIndex > 0;
  }, [activeCellId, cells]);

  const canMoveDown = useMemo(() => {
    if (!activeCellId || !cellManager.current) return false;
    const cellIndex = cells.findIndex(cell => cell.id === activeCellId);
    return cellIndex < cells.length - 1;
  }, [activeCellId, cells]);

  // Handle sending a message with command checking
  const handleCommandOrSendMessage = useCallback((message: string) => {
    if (!isReady) {
      setInitializationError("AI assistant is not ready. Please wait.");
      return;
    }
    // Check if it's a command
    if (message.startsWith('/') || message.startsWith('#')) {
      handleCommand(message); // Corrected: pass only message
      return;
    }
    // Otherwise, send it as a chat message using the hook's function
    cellManager.current?.clearRunningState();
    handleSendChatMessage(message);
  }, [isReady, handleCommand, handleSendChatMessage, setInitializationError]);

  // Add handleCreateNewNotebook function before the return statement
  const handleCreateNewNotebook = useCallback(async () => {
    // Generate a new filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = `Untitled_Chat_${timestamp}.ipynb`;

    // Create empty notebook data
    const notebookData: NotebookData = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        ...defaultNotebookMetadata,
        title: 'New Chat',
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
        filePath: filePath,
        projectId: IN_BROWSER_PROJECT.id,
        // Add default agent artifact metadata
        agentArtifact: {
          id: '', // Empty ID indicates it's a new agent
          name: 'New Agent',
          description: 'A new agent created from chat',
          version: '0.1.0',
          manifest: {
            name: 'New Agent',
            description: 'A new agent created from chat',
            version: '0.1.0',
            license: 'CC-BY-4.0',
            welcomeMessage: 'Hi, how can I help you today?',
            type: 'agent',
            created_at: new Date().toISOString()
          }
        }
      },
      cells: []
    };

    try {
      // Save to in-browser storage
      await saveInBrowserFile(filePath, notebookData);
      setSelectedProject(getInBrowserProject());

      // Load the newly created notebook
      await loadNotebookContent(IN_BROWSER_PROJECT.id, filePath);
      setShowWelcomeScreen(false);
      showToast('Created new chat notebook', 'success');
    } catch (error) {
      console.error('Error creating new notebook:', error);
      showToast(`Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [saveInBrowserFile, setSelectedProject, getInBrowserProject, loadNotebookContent]);

  // Add onCreateAgentTemplate function after handleCreateNewNotebook
  const handleCreateAgentTemplate = useCallback(async (agentData: AgentConfigData) => {
    try {
      // Generate a new filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeAgentName = agentData.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `${safeAgentName}_${timestamp}.ipynb`;

      // Create notebook content with system cell containing the template
      const systemCellContent = `# Agent System Cell\n# This cell contains the startup code and system prompt for your agent\n# It will be executed when the agent is initialized\n\nimport os\nimport sys\n\n# Define system prompt\nSYSTEM_PROMPT = """${agentData.initialPrompt}"""\n\n# print the system prompt\nprint(SYSTEM_PROMPT)\n`;

      // Create a welcome message cell from user
      const welcomeMessageCellContent = `I'm ready to help! ${agentData.welcomeMessage}`;

      // Create new notebook with system cell and welcome message
      const notebookData: NotebookData = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          ...defaultNotebookMetadata,
          title: agentData.name,
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          filePath: filePath,
          projectId: IN_BROWSER_PROJECT.id,
          agentArtifact: {
            id: '', // Will be filled when published
            version: agentData.version,
            name: agentData.name,
            description: agentData.description
          }
        },
        cells: [
          {
            id: uuidv4(),
            type: 'code',
            content: systemCellContent,
            executionState: 'idle',
            metadata: {
              trusted: true,
              role: 'system'
            },
            executionCount: undefined,
            output: []
          },
          {
            id: uuidv4(),
            type: 'markdown',
            content: welcomeMessageCellContent,
            executionState: 'idle',
            metadata: {
              role: 'assistant'
            }
          }
        ]
      };

      // Save to in-browser storage
      await saveInBrowserFile(filePath, notebookData);
      setSelectedProject(getInBrowserProject());

      // Load the newly created notebook
      await loadNotebookContent(IN_BROWSER_PROJECT.id, filePath);
      setShowWelcomeScreen(false);
      showToast('Created new agent template', 'success');
    } catch (error) {
      console.error('Error creating agent template:', error);
      showToast(`Failed to create agent template: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      throw error; // Re-throw to allow the caller to handle it
    }
  }, [saveInBrowserFile, setSelectedProject, getInBrowserProject, loadNotebookContent]);

  // --- Callback to save agent settings from canvas to notebook metadata ---
  const handleSaveAgentSettingsToNotebook = useCallback((data: EditAgentFormData) => {
    const agentArtifactMeta = notebookMetadata.agentArtifact ? {
      ...notebookMetadata.agentArtifact,
      id: data.agentId || notebookMetadata.agentArtifact.id || '', // Preserve existing ID if not provided/cleared
      name: data.name,
      description: data.description,
      version: data.version,
      manifest: {
        ...(notebookMetadata.agentArtifact.manifest || {}),
        name: data.name,
        description: data.description,
        version: data.version,
        license: data.license,
        welcomeMessage: data.welcomeMessage,
        startup_script: data.initialPrompt,
      }
    } : {
      // Create a minimal structure if no artifact existed before
      id: data.agentId || '',
      name: data.name,
      description: data.description,
      version: data.version,
      manifest: {
        name: data.name,
        description: data.description,
        version: data.version,
        license: data.license,
        welcomeMessage: data.welcomeMessage,
        startup_script: data.initialPrompt,
      }
    };

    // Save model settings to notebook metadata

    // Update notebook metadata with agent config (but not model settings)
    setNotebookMetadata(prev => ({
      ...prev,
      title: data.name, // Update notebook title too
      agentArtifact: agentArtifactMeta,
      modified: new Date().toISOString()
    }));

    // Trigger a save of the notebook itself
    saveNotebook(); // saveNotebook already shows toasts
    showToast('Agent settings saved to notebook', 'success');

  }, [notebookMetadata, setNotebookMetadata, saveNotebook]);

  // --- Callback to publish agent from canvas ---
  const handlePublishAgentFromCanvas = useCallback(async (data: EditAgentFormData, isUpdating: boolean): Promise<string | null> => {
    if (!artifactManager || !isLoggedIn) {
      showToast('You need to be logged in to publish an agent', 'error');
      return null; // Indicate failure
    }

    const toastId = 'publishing-agent-canvas';
    showToast('Publishing agent...', 'loading', { id: toastId });

    await saveNotebook(); // Ensure notebook is saved first

    try {
      // Get system cell content (if needed for manifest)
      const systemCellContent = systemCell ? systemCell.content : '';

      // Create agent manifest (ensure modelConfig is included)
      const manifest = {
        name: data.name,
        description: data.description,
        version: data.version,
        license: data.license,
        type: 'agent',
        created_at: new Date().toISOString(),
        startup_script: systemCellContent,
        welcomeMessage: data.welcomeMessage,
        modelConfig: agentSettings, // Include model settings in manifest
        // Add chat template to preserve notebook state
        chat_template: {
          metadata: notebookMetadata,
          cells: cellManager.current?.getCurrentCellsContent() || []
        }
      };

      console.log('[AgentLab] Publishing agent with data:', {
        isUpdating,
        agentId: data.agentId,
        manifest: { ...manifest, startup_script: '<<SCRIPT>>' } // Log without script for brevity
      });

      let artifact;

      // Use agentId from the form data to determine update vs create
      if (isUpdating && data.agentId) {
        // Update existing agent
        console.log('[AgentLab] Updating existing agent:', data.agentId);
        artifact = await artifactManager.edit({
          artifact_id: data.agentId,
          type: "agent",
          manifest: manifest,
          version: manifest.version, // Use the version from the form
          _rkwargs: true
        });
        console.log('[AgentLab] Agent updated successfully:', artifact);
        dismissToast(toastId);
        showToast('Agent updated successfully!', 'success');
      } else {
        // Create a new agent
        console.log('[AgentLab] Creating new agent');
        artifact = await artifactManager.create({
          parent_id: `${SITE_ID}/agents`,
          type: "agent",
          manifest: manifest,
          _rkwargs: true
        });
        console.log('[AgentLab] Agent created successfully:', artifact);
        dismissToast(toastId);
        showToast('Agent published successfully!', 'success');
      }

      // Update notebook metadata with the definitive published artifact info
      const finalAgentArtifactMeta = {
        id: artifact.id,
        version: artifact.version,
        name: manifest.name,
        description: manifest.description,
        manifest: manifest
      };

      setNotebookMetadata(prev => ({
        ...prev,
        title: manifest.name, // Ensure title is updated
        agentArtifact: finalAgentArtifactMeta,
        modified: new Date().toISOString()
      }));

      // Save the notebook again to store the final artifact ID/version
      await saveNotebook();

      return artifact.id; // Return the new/updated ID on success

    } catch (error) {
      console.error('Error publishing agent from canvas:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`Failed to publish agent: ${errorMessage}`, 'error', { id: toastId });
      return null; // Indicate failure
    }
  }, [
    artifactManager, isLoggedIn, systemCell, notebookMetadata, saveNotebook,
    setNotebookMetadata, cellManager, showToast, dismissToast, SITE_ID, agentSettings
  ]);

  // --- Function to show Model Settings in Canvas Panel ---
  const handleShowModelSettingsInCanvas = useCallback(() => {
    const windowId = 'model-settings';

    // Check if window already exists
    const windowExists = hyphaCoreWindows.some(win => win.id === windowId);

    if (windowExists) {
      // Just activate the existing tab
      setActiveCanvasTab(windowId);
      setShowCanvasPanel(true);
      return;
    }

    // Create a new window
    const newWindow: HyphaCoreWindow = {
      id: windowId,
      name: 'Model Settings',
      component: (
        <ModelSettingsCanvasContent
          onSettingsChange={setAgentSettings}
        />
      )
    };

    setHyphaCoreWindows(prev => [...prev, newWindow]);
    setActiveCanvasTab(windowId);
    setShowCanvasPanel(true);
  }, [hyphaCoreWindows, setHyphaCoreWindows, setActiveCanvasTab, setShowCanvasPanel, setAgentSettings]);

  // --- Generic function to show/update window in Canvas Panel ---
  const showWindowInCanvas = useCallback((windowId: string, windowName: string, component: React.ReactNode) => {
    // Check if window already exists
    const windowExists = hyphaCoreWindows.some(win => win.id === windowId);

    if (windowExists) {
      // Update existing window
      setHyphaCoreWindows(prev => prev.map(win => {
        if (win.id === windowId) {
          return {
            ...win,
            name: windowName,
            component
          };
        }
        return win;
      }));
    } else {
      // Create a new window
      const newWindow: HyphaCoreWindow = {
        id: windowId,
        name: windowName,
        component
      };
      setHyphaCoreWindows(prev => [...prev, newWindow]);
    }

    // Activate the tab and show the panel
    setActiveCanvasTab(windowId);
    setShowCanvasPanel(true);
  }, [hyphaCoreWindows, setHyphaCoreWindows, setActiveCanvasTab, setShowCanvasPanel]);

  // --- Function to show Edit Agent in Canvas Panel ---
  const handleShowEditAgentInCanvas = useCallback(() => {
    const agentArtifact = notebookMetadata.agentArtifact;

    // Prepare initial agent data, including the existing ID if available
    const initialAgentData: Partial<EditAgentFormData> = {
      agentId: agentArtifact?.id || '', // Pass existing ID
      name: agentArtifact?.name || notebookMetadata.title || '',
      description: agentArtifact?.description || '',
      version: agentArtifact?.version || '0.1.0',
      license: agentArtifact?.manifest?.license || 'CC-BY-4.0',
      welcomeMessage: agentArtifact?.manifest?.welcomeMessage || 'Hi, how can I help you today?',
      initialPrompt: systemCell ? systemCell.content : ''
    };

    showWindowInCanvas(
      'edit-agent-config',
      `Edit: ${initialAgentData.name || 'Agent'}`,
      <EditAgentCanvasContent
        initialAgentData={initialAgentData}
        onSaveSettingsToNotebook={handleSaveAgentSettingsToNotebook}
        onPublishAgent={handlePublishAgentFromCanvas}
      />
    );

  }, [notebookMetadata, showWindowInCanvas, handleSaveAgentSettingsToNotebook, handlePublishAgentFromCanvas, systemCell]);

  // Add an effect to handle showing edit window when notebookMetadata changes
  useEffect(() => {
    if (showEditAgentAfterLoad && notebookMetadata.agentArtifact) {
      handleShowEditAgentInCanvas();
      setShowEditAgentAfterLoad(false);
    }
  }, [showEditAgentAfterLoad, notebookMetadata, handleShowEditAgentInCanvas]);

  // Update the handleEditAgentFromWelcomeScreen function
  const handleEditAgentFromWelcomeScreen = useCallback(async (workspace: string, agentId: string) => {
    if (!artifactManager || !isLoggedIn) {
      showToast('You need to be logged in to edit an agent', 'error');
      return;
    }

    if(!agentId.includes('/')) {
      agentId = `${SITE_ID}/${agentId}`;
    }

    const loadingToastId = 'editing-agent';
    showToast('Loading agent for editing...', 'loading', { id: loadingToastId });

    try {
      // Get the agent artifact
      const agent = await artifactManager.read({ artifact_id: agentId, _rkwargs: true });
      if (!agent || !agent.manifest) {
        throw new Error('Agent not found or invalid manifest');
      }

      // Create a fixed filename for the notebook
      const filePath = `chat-${agentId.split('/').pop()}.ipynb`;
      const resolvedProjectId = IN_BROWSER_PROJECT.id;

      // Get template from manifest or create minimal structure
      const template = agent.manifest.chat_template || {};

      // Create notebook data from template or create a new one
      const notebookData: NotebookData = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          ...defaultNotebookMetadata,
          // Only include non-model settings from template metadata
          ...(template.metadata ? {
            title: template.metadata.title,
            description: template.metadata.description,
            // Exclude modelSettings
          } : {}),
          title: agent.manifest.name || 'Agent Chat',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          filePath: filePath,
          projectId: resolvedProjectId,
          agentArtifact: {
            id: agent.id,
            version: agent.version,
            name: agent.manifest.name,
            description: agent.manifest.description,
            manifest: {
              ...agent.manifest,
              // Don't include modelConfig in the notebook metadata
            }
          }
        },
        cells: template.cells || []
      };

      // If no cells in template, create a system cell with the agent's startup script
      if (notebookData.cells.length === 0 && agent.manifest.startup_script) {
        const systemCellContent = agent.manifest.startup_script;
        notebookData.cells.push({
          id: uuidv4(),
          type: 'code',
          content: systemCellContent,
          executionState: 'idle',
          metadata: {
            trusted: true,
            role: 'system'
          },
          executionCount: undefined,
          output: []
        });
      }

      // Save the notebook
      if (resolvedProjectId === IN_BROWSER_PROJECT.id) {
        await saveInBrowserFile(filePath, notebookData);
        setSelectedProject(getInBrowserProject());
      } else {
        const blob = new Blob([JSON.stringify(notebookData, null, 2)], { type: 'application/json' });
        const file = new File([blob], filePath.split('/').pop() || 'notebook.ipynb', { type: 'application/json' });
        await uploadFile(resolvedProjectId, file);
      }

      // Load the newly created notebook
      await loadNotebookContent(resolvedProjectId, filePath);
      
      // Set flag to show edit dialog after notebookMetadata is updated
      setShowEditAgentAfterLoad(true);
      
      showToast('Agent loaded for editing', 'success');
      dismissToast(loadingToastId);

    } catch (error) {
      console.error('Error editing agent:', error);
      showToast(`Failed to edit agent: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      dismissToast(loadingToastId);
    }
  }, [
    artifactManager,
    isLoggedIn,
    saveInBrowserFile,
    uploadFile,
    loadNotebookContent,
    setSelectedProject,
    getInBrowserProject,
    showToast,
    dismissToast
  ]);

  // --- Callback to show Thebe Terminal in Canvas Panel ---
  const handleShowThebeTerminalInCanvas = useCallback(() => {
    const windowId = 'thebe-terminal';
    const windowExists = hyphaCoreWindows.some(win => win.id === windowId);

    if (!windowExists) {
      const newWindow: HyphaCoreWindow = {
        id: windowId,
        name: 'Kernel Terminal',
        component: (
          <ThebeTerminalPanel /> // Use the refactored component
        )
      };
      setHyphaCoreWindows(prev => [...prev, newWindow]);
    }

    setActiveCanvasTab(windowId);
    setShowCanvasPanel(true);

  }, [hyphaCoreWindows, setHyphaCoreWindows, setActiveCanvasTab, setShowCanvasPanel]); // Dependencies


  // --- Render Logic ---
  if (!initRefObject.current) {
    return <div className="flex justify-center items-center h-screen">Initializing...</div>;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <NotebookHeader
        metadata={notebookMetadata}
        fileName={notebookFileName}
        onMetadataChange={setNotebookMetadata}
        onSave={saveNotebook}
        onDownload={handleDownloadNotebook}
        onLoad={loadNotebookFromFile}
        onRunAll={handleRunAllCells}
        onClearOutputs={handleClearAllOutputs}
        onRestartKernel={handleRestartKernel}
        onAddCodeCell={handleAddCodeCell}
        onAddMarkdownCell={handleAddMarkdownCell}
        onShowKeyboardShortcuts={() => setIsShortcutsDialogOpen(true)}
        isProcessing={isProcessingAgentResponse}
        isKernelReady={isReady}
        isAIReady={isAIReady}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isSidebarOpen={isSidebarOpen}
        onMoveCellUp={handleMoveCellUp}
        onMoveCellDown={handleMoveCellDown}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        isWelcomeScreen={showWelcomeScreen}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          onLoadNotebook={handleLoadNotebook}
        />

        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden transition-all duration-300">
          {showWelcomeScreen ? (
            <WelcomeScreen
              urlParams={parsedUrlParams}
              isLoggedIn={isLoggedIn}
              onStartNewChat={handleCreateNewNotebook}
              onStartFromAgent={createNotebookFromAgentTemplate}
              onCreateAgentTemplate={handleCreateAgentTemplate}
              onEditAgent={handleEditAgentFromWelcomeScreen}
              onOpenFile={loadNotebookContent}
            />
          ) : (
            <>
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="max-w-5xl mx-auto px-0 sm:px-4 py-1 pb-48">
                    <NotebookContent
                      cells={cells}
                      activeCellId={activeCellId || ''}
                      onActiveCellChange={handleActiveCellChange}
                      onExecuteCell={handleExecuteCell}
                      onUpdateCellContent={handleUpdateCellContent}
                      onToggleCellEditing={handleToggleCellEditing}
                      onToggleCodeVisibility={handleToggleCodeVisibility}
                      onToggleOutputVisibility={handleToggleOutputVisibility}
                      onChangeCellType={handleCellTypeChange}
                      onUpdateCellRole={handleUpdateCellRole}
                      onDeleteCell={handleDeleteCell}
                      onDeleteCellWithChildren={handleDeleteCellWithChildren}
                      onToggleCellCommitStatus={handleToggleCellCommitStatus}
                      onRegenerateClick={handleRegenerateClick}
                      onStopChatCompletion={handleAbortExecution}
                      getEditorRef={getEditorRef}
                      isReady={isReady}
                      activeAbortController={activeAbortController}
                      showCanvasPanel={showCanvasPanel}
                      onAbortExecution={handleAbortExecution}
                    />
                  </div>
                </div>

                <div className="sticky bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm pt-1 px-4 pb-4 shadow-md z-100">
                  <NotebookFooter
                    onSendMessage={handleCommandOrSendMessage}
                    onStopChatCompletion={handleAbortExecution}
                    isProcessing={isProcessingAgentResponse}
                    isThebeReady={isReady}
                    thebeStatus={kernelStatus}
                    isAIReady={isAIReady}
                    initializationError={initializationError}
                    onShowThebeTerminal={handleShowThebeTerminalInCanvas}
                    onModelSettingsChange={handleShowModelSettingsInCanvas}
                    onShowEditAgent={handleShowEditAgentInCanvas}
                  />
                </div>
              </div>

              <CanvasPanel
                windows={hyphaCoreWindows}
                isVisible={showCanvasPanel}
                activeTab={activeCanvasTab}
                onResize={handleCanvasPanelResize}
                onClose={toggleCanvasPanel}
                onTabChange={setActiveCanvasTab}
                onTabClose={handleTabClose}
                defaultWidth={canvasPanelWidth}
              />
              </div>

              <KeyboardShortcutsDialog
                isOpen={isShortcutsDialogOpen}
                onClose={() => setIsShortcutsDialogOpen(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Wrap NotebookPage with providers
const AgentLab: React.FC = () => {
  return (
    <ThebeProvider>
      <ProjectsProvider>
        <NotebookPage />
      </ProjectsProvider>
    </ThebeProvider>
  );
};

export default AgentLab;