import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Resource } from '../types/resource';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Stack, Divider, IconButton } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import ModelTester from './ModelTester';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import Link from '@mui/material/Link';
import ChatIcon from '@mui/icons-material/Chat';
import { SITE_ID, SERVER_URL } from '../utils/env';

const ResourceDetails = () => {
  const { id } = useParams();
  const { selectedResource, fetchResource, isLoading, error } = useHyphaStore();
  const [documentation, setDocumentation] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Store covers in a local variable
  const covers = selectedResource?.manifest.covers || [];

  // Add this variable to control button state
  const shouldDisableChat = !selectedResource?.manifest?.agent_config;

  useEffect(() => {
    if (id) {
      fetchResource(`${SITE_ID}/${id}`);
    }
  }, [id, fetchResource]);

  useEffect(() => {
    const fetchDocumentation = async () => {
      if (selectedResource?.manifest.documentation) {
        try {
          const docUrl = resolveHyphaUrl(selectedResource.manifest.documentation, selectedResource.id);
          
          const response = await fetch(docUrl);
          const text = await response.text();
          setDocumentation(text);
        } catch (error) {
          console.error('Failed to fetch documentation:', error);
        }
      }
    };

    fetchDocumentation();
  }, [selectedResource?.id, selectedResource?.manifest.documentation]);

  const handleDownload = () => {
    if (id) {
      window.open(`${SERVER_URL}/${SITE_ID}/artifacts/${id}/create-zip-file`, '_blank');
    }
  };

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (covers.length > 0) {
      setCurrentImageIndex((prev) => (prev + 1) % covers.length);
    }
  };

  const previousImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (covers.length > 0) {
      setCurrentImageIndex((prev) => 
        (prev - 1 + covers.length) % covers.length
      );
    }
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (!selectedResource) {
    return <div>Resource not found</div>;
  }

  const { manifest } = selectedResource as Resource;

  return (
    <Box sx={{ p: 3, maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
        {manifest.id_emoji} {manifest.name} 
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          ID: {selectedResource.id}
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>{manifest.description}</Typography>
        
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            onClick={handleDownload}
            startIcon={<DownloadIcon />}
            variant="contained"
            size="medium"
            sx={{
              backgroundColor: '#2563eb',
              '&:hover': {
                backgroundColor: '#1d4ed8',
              },
            }}
          >
            Download
          </Button>
          <Button
            component={RouterLink}
            to={`/chat/${selectedResource.id.split('/').pop()}`}
            variant="contained"
            size="medium"
            startIcon={<ChatIcon />}
            disabled={shouldDisableChat}
            sx={{
              backgroundColor: '#3b82f6',
              '&:hover': {
                backgroundColor: '#2563eb',
              },
              '&.Mui-disabled': {
                backgroundColor: '#d1d5db',
              },
            }}
          >
            Start Chat
          </Button>
          {manifest.version && (
            <Chip 
              icon={<UpdateIcon />} 
              label={`Version: ${manifest.version}`}
              sx={{ ml: 2 }} 
            />
          )}
        </Box>
      </Box>

      {/* Cover Image Section */}
      {covers.length > 0 && (
        <Box 
          sx={{ 
            position: 'relative',
            width: '100%',
            height: '400px',
            mb: 3,
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: '#f5f5f5'
          }}
        >
          <img
            src={resolveHyphaUrl(covers[currentImageIndex], selectedResource.id)}
            alt={`Cover ${currentImageIndex + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
          {covers.length > 1 && (
            <>
              <IconButton
                onClick={previousImage}
                sx={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  }
                }}
              >
                <NavigateBeforeIcon />
              </IconButton>
              <IconButton
                onClick={nextImage}
                sx={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  }
                }}
              >
                <NavigateNextIcon />
              </IconButton>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: 1,
                  fontSize: '0.875rem'
                }}
              >
                {currentImageIndex + 1} / {covers.length}
              </Box>
            </>
          )}
        </Box>
      )}

      <Grid container spacing={3}>
        {/* Left Column - Documentation */}
        <Grid item xs={12} md={8}>
          {/* Documentation Card */}
          {documentation && (
            <Card sx={{ mb: 3, height: '100%' }}>
              <CardContent>
                <Box 
                  sx={{ 
                    padding: '45px',
                    '& pre': {
                      maxWidth: '100%',
                      overflow: 'auto'
                    },
                    '& img': {
                      maxWidth: '100%',
                      height: 'auto'
                    }
                  }}
                >
                  <ReactMarkdown className="markdown-body">{documentation}</ReactMarkdown>
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={4}>

          {/* Authors Card - Moved from left column */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Authors
              </Typography>
              {manifest.authors?.map((author, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                    {author.name}
                  </Typography>
                  {author.orcid && (
                    <Link 
                      href={`https://orcid.org/${author.orcid}`}
                      target="_blank"
                      sx={{ 
                        display: 'inline-block',
                        fontSize: '0.875rem',
                        mb: 0.5 
                      }}
                    >
                      ORCID: {author.orcid}
                    </Link>
                  )}
                  {author.affiliation && (
                    <Typography variant="body2" color="text.secondary">
                      <SchoolIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                      {author.affiliation}
                    </Typography>
                  )}
                  {index < (manifest.authors?.length ?? 0) - 1 && <Divider sx={{ my: 2 }} />}
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Statistics Card - New */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Statistics
              </Typography>
              <Stack spacing={1}>
                <Chip 
                  icon={<DownloadIcon />} 
                  label={`Downloads: ${selectedResource.download_count}`}
                  sx={{ justifyContent: 'flex-start' }}
                />
                <Chip 
                  icon={<VisibilityIcon />} 
                  label={`Views: ${selectedResource.view_count}`}
                  sx={{ justifyContent: 'flex-start' }}
                />
              </Stack>
            </CardContent>
          </Card>

          {/* Citations Card */}
          {manifest.cite && manifest.cite.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Citations
                </Typography>
                {manifest.cite.map((citation, index) => (
                  <Box key={index}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {citation.text}
                    </Typography>
                    {citation.doi && (
                      <Link 
                        href={`https://doi.org/${citation.doi}`}
                        target="_blank"
                        sx={{ 
                          display: 'inline-block',
                          fontSize: '0.875rem'
                        }}
                      >
                        DOI: {citation.doi}
                      </Link>
                    )}
                    {index < (manifest.cite?.length ?? 0) - 1 && <Divider sx={{ my: 2 }} />}
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Tags Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <LocalOfferIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Tags
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {manifest.tags?.map((tag, index) => (
                  <Chip key={index} label={tag} size="small" />
                ))}
              </Box>
            </CardContent>
          </Card>

          {/* Links Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <LinkIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Links
              </Typography>
              <Stack spacing={1}>
                {manifest.git_repo && (
                  <Link href={manifest.git_repo} target="_blank">
                    GitHub Repository
                  </Link>
                )}
                {manifest.documentation && (
                  <Link href={manifest.documentation} target="_blank">
                    Documentation
                  </Link>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* License Card */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>License</Typography>
              <Typography variant="body1">{manifest.license}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ResourceDetails; 