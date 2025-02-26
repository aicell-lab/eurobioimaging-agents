import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import axios from 'axios';
import { LinearProgress } from '@mui/material';
import yaml from 'js-yaml';
import { Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import ModelTester from './ModelTester';
import ModelValidator from './ModelValidator';
import { SITE_ID, SITE_NAME } from '../utils/env';

interface FileNode {
  name: string;
  path: string;
  content: string | ArrayBuffer;
  isDirectory: boolean;
  children?: FileNode[];
  edited?: boolean;
}

interface Manifest {
  version?: string;
  [key: string]: any;
}

interface UploadStatus {
  message: string;
  severity: 'info' | 'success' | 'error';
  progress?: number;
}

interface ValidationResult {
  success: boolean;
  details: string;
}

interface TestResult {
  name: string;
  success: boolean;
  details: Array<{
    name: string;
    status: string;
    errors: Array<{
      msg: string;
      loc: string[];
    }>;
    warnings: Array<{
      msg: string;
      loc: string[];
    }>;
  }>;
}

type SupportedTextFiles = '.txt' | '.yml' | '.yaml' | '.json' | '.md' | '.py' | '.js' | '.ts' | '.jsx' | '.tsx' | '.css' | '.html';
type SupportedImageFiles = '.png' | '.jpg' | '.jpeg' | '.gif';

interface UploadProps {
  artifactId?: string;
  onBack?: () => void;
}

// Add new interface for upload artifact
interface UploadArtifact {
  id: string;
  version: string;
  // Add other properties as needed
}

const Upload: React.FC<UploadProps> = ({ artifactId, onBack }) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const { artifactManager, isLoggedIn, server } = useHyphaStore();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showDragDrop, setShowDragDrop] = useState(!files.length);
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const [uploadedArtifact, setUploadedArtifact] = useState<UploadArtifact | null>(null);

  useEffect(() => {
    if (artifactId) {
      loadArtifactFiles();
    }
  }, [artifactId]);

  useEffect(() => {
    if (files.some(f => f.edited)) {
      setIsValidated(false);
      setTestResult(null);
    }
  }, [files]);

  const isTextFile = (filename: string): boolean => {
    const textExtensions: SupportedTextFiles[] = ['.txt', '.yml', '.yaml', '.json', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html'];
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const isImageFile = (filename: string): boolean => {
    const imageExtensions: SupportedImageFiles[] = ['.png', '.jpg', '.jpeg', '.gif'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getImageDataUrl = async (content: string | ArrayBufferLike, fileName: string): Promise<string> => {
    if (typeof content === 'string') {
      const encoder = new TextEncoder();
      content = encoder.encode(content).buffer;
    }

    const extension = fileName.toLowerCase().split('.').pop() || '';
    const bytes = new Uint8Array(content as ArrayBuffer);
    const binary = bytes.reduce((data, byte) => data + String.fromCharCode(byte), '');
    const base64 = btoa(binary);
    
    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    return `data:${mimeType};base64,${base64}`;
  };

  const getEditorLanguage = (filename: string): string => {
    const extension = filename.toLowerCase().split('.').pop() || '';
    const languageMap: Record<string, string> = {
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'css': 'css',
      'html': 'html',
      'json': 'json',
      'yml': 'yaml',
      'yaml': 'yaml',
      'md': 'markdown',
      'txt': 'plaintext'
    };
    return languageMap[extension] || 'plaintext';
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const zipFile = acceptedFiles[0];
    const zip = new JSZip();
    
    try {
      const loadedZip = await zip.loadAsync(zipFile);
      const fileNodes: FileNode[] = [];

      for (const [path, file] of Object.entries(loadedZip.files)) {
        if (!file.dir) {
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          
          const isImage = fileName.match(/\.(png|jpg|jpeg|gif)$/i);
          const content = await file.async(isImage ? 'arraybuffer' : 'string');

          fileNodes.push({
            name: fileName,
            path: path,
            content: content,
            isDirectory: false
          });
        }
      }

      setFiles(fileNodes);
      setShowDragDrop(false);
      
      // Set upload status with number of files loaded
      setUploadStatus({
        message: `${fileNodes.length} files loaded`,
        severity: 'info'
      });

      const rdfFile = fileNodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      }
    } catch (error) {
      console.error('Error reading zip file:', error);
      setUploadStatus({
        message: 'Error reading zip file',
        severity: 'error'
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'application/zip': ['.zip']
    }
  });

  const handleFileSelect = async (file: FileNode) => {
    setSelectedFile(file);
    setImageUrl(null);
    
    if (isImageFile(file.name)) {
      try {
        const url = await getImageDataUrl(file.content, file.name);
        setImageUrl(url);
      } catch (error) {
        console.error('Error generating image URL:', error);
      }
    }
  };

  const handleEditorChange = (value: string | undefined, file: FileNode) => {
    if (value) {
      setFiles(files.map(f => 
        f.path === file.path 
          ? { ...f, content: value, edited: true }
          : f
      ));
    }
  };

  const handleValidationComplete = (result: ValidationResult) => {
    setIsValidated(result.success);
    setUploadStatus({
      message: result.success ? 'Validation successful!' : 'Validation failed',
      severity: result.success ? 'success' : 'error',
      ...(uploadStatus?.progress !== undefined && { progress: uploadStatus.progress })
    });
    if (result.success && !uploadedArtifact && artifactId) {
      setUploadedArtifact({
        id: artifactId,
        version: 'stage'
      });
    }
  };

  const handleUpload = async () => {
    if (isUploading) return;
    
    if (!artifactManager) {
      setUploadStatus({
        message: 'Artifact manager not connected',
        severity: 'error'
      });
      return;
    }

    try {
      setIsUploading(true);
      setUploadStatus({
        message: 'Reading manifest file...',
        severity: 'info'
      });

      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (!rdfFile) {
        throw new Error('No rdf.yaml file found in the upload');
      }

      let manifest: Manifest;
      try {
        const content = typeof rdfFile.content === 'string' 
          ? rdfFile.content
          : new TextDecoder().decode(rdfFile.content);
        manifest = yaml.load(content) as Manifest;
        if (manifest?.version) {
          manifest.version = `${manifest.version}`;
        }
      } catch (error) {
        console.error('Error parsing rdf.yaml:', error);
        throw new Error('Invalid rdf.yaml format');
      }

      let artifactId: string;
      // If we already have an artifact ID, use it, otherwise create new
      if (uploadedArtifact) {
        artifactId = uploadedArtifact.id;
      } else {
        const artifact =await artifactManager.create({
          parent_id: `${SITE_ID}/agents`,
          type: manifest.type,
          manifest: manifest,
          config: {
          },
          version: "stage",
          _rkwargs: true,
          overwrite: true,
        })
        artifactId = artifact.id;
        setUploadedArtifact(artifact);
      }

      setUploadStatus({
        message: `Artifact ${uploadedArtifact ? 'updated' : 'created'} with ID: ${artifactId}`,
        severity: 'info'
      });

      // Filter files that have been edited
      const filesToUpload = files.filter(file => file.edited || !uploadedArtifact);
      
      // Upload only edited files sequentially with progress
      for (let index = 0; index < filesToUpload.length; index++) {
        const file = filesToUpload[index];
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info',
          progress: (index / filesToUpload.length) * 100
        });

        const putUrl = await artifactManager.put_file({
          artifact_id: artifactId,
          file_path: file.path,
          _rkwargs: true,
        });
        console.log(`Uploading ${file.name} to ${putUrl}`);
        const blob = new Blob([file.content], { type: "application/octet-stream" });
        await axios.put(putUrl, blob, {
          headers: {
            "Content-Type": "" // Ensure the Content-Type header is empty if not expected
          },
          onUploadProgress: (progressEvent) => {
            const progress = progressEvent.total
              ? (progressEvent.loaded / progressEvent.total) * 100
              : 0;
            
            setUploadStatus({
              message: `Uploading ${file.name}...`,
              severity: 'info',
              progress: ((index + (progress / 100)) / filesToUpload.length) * 100
            });
          }
        });
      }

      // Reset edited flags after successful upload
      setFiles(files.map(file => ({ ...file, edited: false })));

      setUploadStatus({
        message: `${uploadedArtifact ? 'Update' : 'Upload'} complete!`,
        severity: 'success',
        progress: 100
      });

      setIsUploaded(true);

    } catch (error) {
      console.error('Upload failed:', error);
      setIsUploaded(false);
      setUploadedArtifact(null); // Reset uploaded artifact on error
      setUploadStatus({
        message: error instanceof Error 
          ? `Upload failed: ${error.message}` 
          : 'Upload failed: Unknown error occurred',
        severity: 'error'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (isUploading) return;
    
    if (!artifactManager || !uploadedArtifact) {
      setUploadStatus({
        message: 'No artifact to save to',
        severity: 'error'
      });
      return;
    }

    try {
      setIsUploading(true);
      
      // Filter files that have been edited
      const filesToUpload = files.filter(file => file.edited);
      
      // Upload only edited files sequentially with progress
      for (let index = 0; index < filesToUpload.length; index++) {
        const file = filesToUpload[index];
        setUploadStatus({
          message: `Saving ${file.name}...`,
          severity: 'info',
          progress: (index / filesToUpload.length) * 100
        });

        const putUrl = await artifactManager.put_file({
          artifact_id: uploadedArtifact.id,
          file_path: file.path,
          _rkwargs: true,
        });
        
        const blob = new Blob([file.content], { type: "application/octet-stream" });
        await axios.put(putUrl, blob, {
          headers: {
            "Content-Type": ""
          },
          onUploadProgress: (progressEvent) => {
            const progress = progressEvent.total
              ? (progressEvent.loaded / progressEvent.total) * 100
              : 0;
            
            setUploadStatus({
              message: `Saving ${file.name}...`,
              severity: 'info',
              progress: ((index + (progress / 100)) / filesToUpload.length) * 100
            });
          }
        });
      }

      // Reset edited flags after successful save
      setFiles(files.map(file => ({ ...file, edited: false })));

      setUploadStatus({
        message: 'Changes saved successfully!',
        severity: 'success',
        progress: 100
      });

    } catch (error) {
      console.error('Save failed:', error);
      setUploadStatus({
        message: error instanceof Error 
          ? `Save failed: ${error.message}` 
          : 'Save failed: Unknown error occurred',
        severity: 'error'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusColor = (severity: 'info' | 'success' | 'error') => {
    switch (severity) {
      case 'info':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-500';
    }
  };

  const loadArtifactFiles = async () => {
    if (!artifactManager || !artifactId) return;
    
    try {
      const fileList = await artifactManager.list_files({
        artifact_id: artifactId,
        _rkwargs: true
      });

      // Convert the file list to FileNode format
      const nodes: FileNode[] = await Promise.all(fileList.map(async (file: any) => {
        if (file.type === 'file') {
          const content = await loadFileContent(file.name);
          return {
            name: file.name,
            path: file.name,
            content: content,
            isDirectory: false
          };
        }
        return {
          name: file.name,
          path: file.name,
          content: '',
          isDirectory: true,
          children: []
        };
      }));

      setFiles(nodes);
      setShowDragDrop(false);

      // Select rdf.yaml by default if it exists
      const rdfFile = nodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      }
    } catch (error) {
      console.error('Error loading artifact files:', error);
    }
  };

  const loadFileContent = async (filePath: string) => {
    if (!artifactManager || !artifactId) return '';

    try {
      const url = await artifactManager.get_file({
        artifact_id: artifactId,
        file_path: filePath,
        _rkwargs: true
      });

      const response = await fetch(url);
      const content = await response.text();
      return content;
    } catch (error) {
      console.error('Error loading file content:', error);
      return '';
    }
  };

  const getFirstErrorLine = (details: string) => {
    return details.split('\n')[0];
  };

  // Find the rdf file from the files array
  const getRdfFile = () => {
    return files.find(file => file.path.endsWith('rdf.yaml'));
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Add back button when viewing existing artifact */}
      {onBack && (
        <div className="bg-white border-b border-gray-200 px-4 py-2">
          <button
            onClick={onBack}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to My Agents
          </button>
        </div>
      )}

      {/* Show title section only when no files are loaded */}
      {showDragDrop && (
        <div className="bg-white border-b border-gray-80">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 text-center">
            <h1 className="text-2xl font-semibold text-gray-900">
              Contribute to the {SITE_NAME}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Share your AI models and agents with the community
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-auto">
        {/* Only show sidebar when files are loaded */}
        {files.length > 0 && (
          <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
            <div className="p-4 border-b border-gray-200 flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
                  Contributing to Elia
                </h2>
              <div className="flex items-center justify-between">
               
                <span className="text-sm text-gray-600 font-medium">Package Contents</span>
                {/* <button
                  onClick={() => setShowDragDrop(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50"
                >
                  New Upload
                </button> */}
              </div>
            </div>

            {/* Scrollable file list */}
            <div className="flex-1 overflow-y-auto">
              <div className="py-2">
                {files.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => handleFileSelect(file)}
                    className={`cursor-pointer px-4 py-2.5 hover:bg-gray-100 transition-colors flex items-center gap-3
                      ${selectedFile?.path === file.path ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                  >
                    {/* File Icon */}
                    <span className="flex-shrink-0">
                      {file.name.endsWith('.yaml') || file.name.endsWith('.yml') ? (
                        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      ) : file.name.match(/\.(png|jpg|jpeg|gif)$/i) ? (
                        <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : file.name.endsWith('.py') ? (
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                    </span>

                    {/* File Name with Star for rdf.yaml */}
                    <div className="flex items-center gap-2 flex-1">
                      <span className="truncate text-sm font-medium tracking-wide">
                        {file.name}
                      </span>
                      {file.name === 'rdf.yaml' && (
                        <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      )}
                    </div>

                    {/* Edit Badge */}
                    {file.edited && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                        edited
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {/* Status bar with upload button and progress */}
          {files.length > 0 && (
            <div className="border-b border-gray-200 bg-white">
              {/* Container with padding except bottom when progress bar is shown */}
              <div className={`p-4 ${uploadStatus?.progress !== undefined ? 'pb-0' : ''}`}>
                {/* Flex container that stacks below 1024px */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* Status section */}
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {uploadStatus && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`${getStatusColor(uploadStatus.severity)} text-base truncate`}>
                            {uploadStatus.message}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Buttons section */}
                  <div className="flex gap-2 flex-shrink-0">
                    <ModelValidator
                      rdfContent={getRdfFile()?.content as string}
                      isDisabled={!getRdfFile() || !server}
                      onValidationComplete={handleValidationComplete}
                    />
                    {!uploadedArtifact ? (
                      <button
                        onClick={handleUpload}
                        disabled={isUploading || !isLoggedIn}
                        className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-2
                          ${isUploading || !isLoggedIn
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                      >
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          {!isLoggedIn 
                            ? 'Please login'
                            : isUploading 
                              ? 'Uploading...' 
                              : 'Upload'}
                        </>
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        {files.some(f => f.edited) ? (
                          <button
                            onClick={handleSave}
                            disabled={isUploading || !isLoggedIn}
                            className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-2
                              ${isUploading || !isLoggedIn
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-green-600 text-white hover:bg-green-700'}`}
                          >
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                              </svg>
                              {isUploading ? 'Saving...' : 'Save Changes'}
                            </>
                          </button>
                        ) : (
                          <button
                            disabled
                            className="px-6 py-2 rounded-md font-medium bg-gray-100 text-gray-400 cursor-not-allowed flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                            </svg>
                            Changes Saved
                          </button>
                        )}
                        {/* Only show ModelTester when not uploading and no files are edited */}
                        {!isUploading && !files.some(f => f.edited) && (
                          <ModelTester
                            artifactId={uploadedArtifact.id}
                            version="stage"
                            isDisabled={!server}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress bar at the bottom edge */}
              {uploadStatus?.progress !== undefined && (
                <LinearProgress 
                  variant="determinate" 
                  value={uploadStatus.progress} 
                  sx={{ 
                    height: 4,
                    borderRadius: 0,
                    marginTop: 1,
                  }}
                />
              )}
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 p-6 overflow-auto">
            {showDragDrop ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-2xl mx-auto">
                  
                  <div 
                    {...getRootProps()} 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:bg-gray-50 transition-colors cursor-pointer mb-8"
                  >
                    <input {...getInputProps()} />
                    <div className="mb-6">
                      <div className="w-16 h-16 mx-auto mb-4">
                        <svg className="w-full h-full text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      {isDragActive ? (
                        <p className="text-lg text-blue-600 font-medium">Drop the zip file here...</p>
                      ) : (
                        <>
                          <p className="text-lg text-gray-700 font-medium mb-2">
                            Drag & drop your model package here
                          </p>
                          <p className="text-gray-500">
                            or click to browse your files
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <Link
                    to="/my-agents"
                    className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 bg-gray-50 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    View My Agents
                  </Link>

                  <div className="space-y-4 text-left bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-xl font-semibold text-gray-700 tracking-tight">
                      Guidelines for Agent Contributions:
                    </h3>
                    <ol className="list-decimal list-inside space-y-3 text-gray-600 text-base">
                      <li className="leading-relaxed">Prepare your agent following the {SITE_NAME} specifications</li>
                      <li className="leading-relaxed">Include a detailed <code className="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono">rdf.yaml</code> file with agent configuration and metadata</li>
                      <li className="leading-relaxed">Add documentation about your agent's capabilities and use cases</li>
                      <li className="leading-relaxed">Package all agent files into a ZIP archive for upload</li>
                    </ol>
                    <div className="mt-6 space-y-4">
                      <p className="text-sm text-gray-500">
                        Your contributions help expand the ecosystem of specialized telecom AI agents and support the broader community.
                      </p>
                      <p className="text-sm text-gray-500">
                        Need assistance? Check our <a href="#" className="text-blue-600 hover:underline font-medium">documentation</a> or 
                        join the <a href="#" className="text-blue-600 hover:underline font-medium">developer community</a>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedFile ? (
              <div className="h-full">
                {isImageFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4">
                    {imageUrl ? (
                      <img 
                        src={imageUrl}
                        alt={selectedFile.name} 
                        className="max-w-full h-auto"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg">
                        <div className="text-gray-400">Loading image...</div>
                      </div>
                    )}
                  </div>
                ) : isTextFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4">
                    <Editor
                      height="70vh"
                      language={getEditorLanguage(selectedFile.name)}
                      value={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
                      onChange={(value) => handleEditorChange(value, selectedFile)}
                      options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: true,
                        readOnly: !isTextFile(selectedFile.name),
                        wordWrap: 'on',
                        lineNumbers: 'on',
                        renderWhitespace: 'selection',
                        folding: true
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
                    <div className="bg-gray-50 p-6 rounded-lg">
                      <h3 className="font-medium text-lg mb-4">File Information</h3>
                      <div className="space-y-2">
                        <p><span className="font-medium">Name:</span> {selectedFile.name}</p>
                        <p><span className="font-medium">Size:</span> {formatFileSize(selectedFile.content instanceof ArrayBuffer ? selectedFile.content.byteLength : selectedFile.content.length)}</p>
                        <p><span className="font-medium">Type:</span> {selectedFile.name.split('.').pop()?.toUpperCase() || 'Unknown'}</p>
                      </div>
                      <p className="mt-4 text-sm text-gray-400">This file type cannot be previewed</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                Select a file to view or edit
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Upload; 