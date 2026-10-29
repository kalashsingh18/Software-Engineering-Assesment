import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Trash2, CheckCircle2, Clock, AlertCircle,
  Send, RefreshCw, LogOut, ShieldCheck, Sparkles, Database,
  Layers, ExternalLink, HelpCircle, Copy, Check, MessageSquare,
  Zap, ArrowRight, CornerDownLeft, SlidersHorizontal, BookOpen
} from 'lucide-react';

const API_BASE = '/api/v1';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('documind_token') || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [healthStatus, setHealthStatus] = useState('healthy');
  const [copiedIdx, setCopiedIdx] = useState(null);

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(d => setHealthStatus(d.status))
      .catch(() => setHealthStatus('down'));
  }, []);

  useEffect(() => {
    if (token) {
      fetchUser();
      fetchDocuments();
      fetchHistory();
    } else {
      setUser(null);
      setDocuments([]);
      setChatHistory([]);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const hasPending = documents.some(d => d.status === 'queued' || d.status === 'processing');
    if (!hasPending) return;

    const interval = setInterval(() => {
      fetchDocuments();
    }, 4000);

    return () => clearInterval(interval);
  }, [documents, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${API_BASE}/documents`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/questions/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const formatted = data.map(item => ({
          question: item.question,
          answer: item.answer,
          citations: item.citations || [],
          usage: {
            latency_ms: item.latency_ms,
            total_tokens: (item.prompt_tokens || 0) + (item.completion_tokens || 0),
            estimated_cost_usd: item.estimated_cost
          },
          grounded: !item.answer.includes("could not find an answer in your uploaded documents")
        }));
        setChatHistory(formatted);
      }
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    const endpoint = authMode === 'signup' ? `${API_BASE}/auth/signup` : `${API_BASE}/auth/login`;
    const payload = authMode === 'signup'
      ? authForm
      : { username_or_email: authForm.username || authForm.email, password: authForm.password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }
      localStorage.setItem('documind_token', data.access_token);
      setToken(data.access_token);
      setUser(data.user);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('documind_token');
    setToken('');
    setUser(null);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Upload failed');
      }
      fetchDocuments();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDoc = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete document and purge all associated vector embeddings?')) return;

    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setDocuments(docs => docs.filter(d => d.id !== id));
        setSelectedDocIds(ids => ids.filter(i => i !== id));
      }
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const toggleSelectDoc = (id) => {
    setSelectedDocIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllDocs = () => {
    if (selectedDocIds.length === documents.length) {
      setSelectedDocIds([]);
    } else {
      setSelectedDocIds(documents.map(d => d.id));
    }
  };

  const sendQuery = async (queryText) => {
    if (!queryText.trim() || asking) return;

    setAsking(true);
    setQuestion('');

    const tempQ = {
      question: queryText,
      answer: '',
      citations: [],
      usage: null,
      loading: true,
      streaming: true
    };
    setChatHistory(prev => [...prev, tempQ]);

    try {
      const res = await fetch(`${API_BASE}/questions/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          question: queryText,
          document_ids: selectedDocIds.length > 0 ? selectedDocIds : null
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Streaming connection failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let streamedAnswer = '';
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'token') {
                streamedAnswer += event.token;
                setChatHistory(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) {
                    last.answer = streamedAnswer;
                    last.loading = false;
                  }
                  return updated;
                });
              } else if (event.type === 'done') {
                setChatHistory(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) {
                    last.citations = event.citations || [];
                    last.usage = event.usage || null;
                    last.streaming = false;
                    last.loading = false;
                  }
                  return updated;
                });
              }
            } catch (e) {
              // Ignore partial JSON
            }
          }
        }
      }
    } catch (err) {
      setChatHistory(prev => [
        ...prev.slice(0, -1),
        {
          question: queryText,
          answer: `Error: ${err.message}`,
          citations: [],
          usage: null,
          grounded: false,
          streaming: false,
          loading: false
        }
      ]);
    } finally {
      setAsking(false);
    }
  };

  const handleAsk = (e) => {
    e.preventDefault();
    sendQuery(question);
  };

  const fillTestCredentials = () => {
    setAuthMode('login');
    setAuthForm({
      email: 'reviewer@documind.ai',
      username: 'demo_reviewer',
      password: 'DocuMindReviewer2026!'
    });
  };

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const renderStatusPill = (status, errorMsg) => {
    switch (status) {
      case 'ready':
        return <span className="status-pill ready"><CheckCircle2 size={12} /> Ready</span>;
      case 'processing':
        return <span className="status-pill processing"><RefreshCw size={12} className="spin" /> Ingesting</span>;
      case 'queued':
        return <span className="status-pill queued"><Clock size={12} /> Queued</span>;
      case 'failed':
        return <span className="status-pill failed" title={errorMsg || 'Failed'}><AlertCircle size={12} /> Failed</span>;
      default:
        return <span className="status-pill">{status}</span>;
    }
  };

  // Helper to render markdown-like text formatting cleanly
  const renderFormattedAnswer = (text) => {
    // If refusal message
    if (text.includes("could not find an answer in your uploaded documents")) {
      return (
        <div className="answer-body refusal-alert">
          ⚠️ <strong>Grounded Refusal:</strong> {text}
        </div>
      );
    }

    const lines = text.split('\n');
    return (
      <div className="answer-body">
        {lines.map((line, idx) => {
          if (!line.trim()) return <div key={idx} style={{ height: '8px' }} />;

          // Process bold markers
          const parts = line.split(/(\*\*.*?\*\*)/g);
          const renderedLine = parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
            }
            return part;
          });

          // Check if bullet point
          if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
            return (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginLeft: '12px', marginTop: '4px' }}>
                <span style={{ color: '#06b6d4' }}>•</span>
                <span>{renderedLine}</span>
              </div>
            );
          }

          return <p key={idx} style={{ marginBottom: '6px' }}>{renderedLine}</p>;
        })}
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <Sparkles size={22} />
          </div>
          <div>
            <div className="brand-title">DocuMind</div>
            <div className="brand-subtitle">Enterprise Grounded AI Knowledge Assistant</div>
          </div>
        </div>

        <div className="header-actions">
          <div className="badge-pill healthy" title="System Diagnostics">
            <div className="pulse-dot" />
            <span>Systems {healthStatus}</span>
          </div>

          {user && (
            <>
              <div className="user-chip">
                <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
                <span>{user.username}</span>
              </div>
              <button onClick={handleLogout} className="btn-logout" title="Log out">
                <LogOut size={14} /> Exit
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main View */}
      {!token ? (
        <div className="auth-wrapper">
          <div className="auth-card">
            <div className="auth-header">
              <div className="auth-title">Welcome to DocuMind</div>
              <div className="auth-subtitle">Sign in to search across company knowledge with verified citations</div>
            </div>

            <div className="auth-tabs">
              <button
                className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => setAuthMode('login')}
              >
                Sign In
              </button>
              <button
                className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => setAuthMode('signup')}
              >
                Sign Up
              </button>
            </div>

            {authError && (
              <div style={{ color: '#fb7185', fontSize: '0.85rem', marginBottom: '18px', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.25)', padding: '12px', borderRadius: '8px' }}>
                {authError}
              </div>
            )}

            <form onSubmit={handleAuth}>
              {authMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    required
                    value={authForm.email}
                    onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
                    placeholder="name@company.com"
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">{authMode === 'signup' ? 'Username' : 'Username or Email'}</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={authForm.username}
                  onChange={e => setAuthForm({ ...authForm, username: e.target.value })}
                  placeholder="Enter your username"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  required
                  value={authForm.password}
                  onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                className="btn-send"
                style={{ width: '100%', height: '46px', justifyContent: 'center', marginTop: '12px' }}
                disabled={authLoading}
              >
                {authLoading ? 'Verifying...' : (authMode === 'signup' ? 'Create Account' : 'Sign In')}
                <ArrowRight size={16} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Left Column: Document Management Hub */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Database size={18} color="#818cf8" />
                <span>Knowledge Base</span>
                <span className="panel-badge">{documents.length}</span>
              </div>
              <button
                onClick={fetchDocuments}
                className="btn-action-icon"
                title="Refresh Documents"
              >
                <RefreshCw size={15} />
              </button>
            </div>

            {/* Drag & Drop Upload Zone */}
            <div
              className="upload-card"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".pdf,.txt,.md"
                onChange={handleUpload}
              />
              <div className="upload-icon-wrapper">
                <Upload size={22} />
              </div>
              <div className="upload-text-main">
                {uploading ? 'Ingesting & Chunking...' : 'Upload Document'}
              </div>
              <div className="upload-text-sub">PDF, Markdown or Plain Text (up to 25MB)</div>
            </div>

            {uploadError && (
              <div style={{ color: '#fb7185', fontSize: '0.8rem', padding: '0 20px 12px' }}>
                ⚠️ {uploadError}
              </div>
            )}

            {/* Document Controls */}
            {documents.length > 0 && (
              <div className="doc-controls">
                <span>Select docs to restrict query:</span>
                <button onClick={handleSelectAllDocs}>
                  {selectedDocIds.length === documents.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
            )}

            {/* Document List */}
            <div className="document-list">
              {documents.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.88rem', padding: '40px 16px' }}>
                  <BookOpen size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <div>No documents uploaded yet.</div>
                  <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>Upload a policy handbook or manual above.</div>
                </div>
              ) : (
                documents.map(doc => {
                  const isSelected = selectedDocIds.includes(doc.id);
                  const ext = doc.filename.split('.').pop()?.toUpperCase() || 'DOC';
                  return (
                    <div
                      key={doc.id}
                      className={`doc-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleSelectDoc(doc.id)}
                      title="Click to toggle filter for questions"
                    >
                      <div className="doc-left">
                        <div className="doc-type-icon">{ext}</div>
                        <div className="doc-details">
                          <div className="doc-name">{doc.filename}</div>
                          <div className="doc-meta">
                            <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
                            <span>•</span>
                            {renderStatusPill(doc.status, doc.error_message)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteDoc(doc.id, e)}
                        className="btn-action-icon"
                        title="Delete document and purge embeddings"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right Column: Grounded AI Assistant */}
          <section className="panel chat-container">
            <div className="panel-header">
              <div className="panel-title">
                <Layers size={18} color="#06b6d4" />
                <span>Grounded Q&A Console</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {chatHistory.length > 0 && (
                  <button
                    onClick={() => setChatHistory([])}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    Clear chat
                  </button>
                )}
              </div>
            </div>

            {/* Scope Indicator Banner */}
            <div className="scope-banner">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <SlidersHorizontal size={14} />
                <span>
                  {selectedDocIds.length > 0
                    ? `Searching across ${selectedDocIds.length} selected document(s)`
                    : `Searching across all ready documents (${documents.filter(d => d.status === 'ready').length} indexed)`}
                </span>
              </div>
              {selectedDocIds.length > 0 && (
                <button
                  onClick={() => setSelectedDocIds([])}
                  style={{ background: 'transparent', border: 'none', color: '#67e8f9', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                >
                  Search all instead
                </button>
              )}
            </div>

            {/* Chat Stream */}
            <div className="chat-history">
              {chatHistory.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon-box">
                    <MessageSquare size={32} />
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                    Ask DocuMind Anything
                  </div>
                  <div style={{ maxWidth: '480px', fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6 }}>
                    Responses are synthesized strictly from retrieved document chunks and cited with exact page numbers. Unanswerable questions are rejected honestly.
                  </div>

                  <div className="suggestions-box">
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>
                      Suggested Questions
                    </div>
                    <div
                      className="suggestion-chip"
                      onClick={() => sendQuery("How many days of paid annual vacation leave do employees get?")}
                    >
                      <span>🌴 How many days of annual vacation leave do employees get?</span>
                      <CornerDownLeft size={14} color="#818cf8" />
                    </div>
                    <div
                      className="suggestion-chip"
                      onClick={() => sendQuery("What is the home office setup stipend and monthly internet reimbursement?")}
                    >
                      <span>💻 What is the home office setup stipend and monthly internet allowance?</span>
                      <CornerDownLeft size={14} color="#818cf8" />
                    </div>
                    <div
                      className="suggestion-chip"
                      onClick={() => sendQuery("What are core collaboration hours across engineering teams?")}
                    >
                      <span>⏰ What are core collaboration hours across engineering teams?</span>
                      <CornerDownLeft size={14} color="#818cf8" />
                    </div>
                  </div>
                </div>
              ) : (
                chatHistory.map((item, idx) => (
                  <div key={idx} className="chat-turn">
                    {/* User Question Row */}
                    <div className="user-message-row">
                      <div className="user-bubble">{item.question}</div>
                    </div>

                    {/* Assistant Response Card */}
                    <div className="assistant-card">
                      <div className="assistant-top">
                        <div className="assistant-brand">
                          <Sparkles size={16} />
                          <span>DocuMind Synthesis</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(item.answer, idx)}
                          className="btn-copy"
                          title="Copy Answer"
                        >
                          {copiedIdx === idx ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                          <span>{copiedIdx === idx ? 'Copied!' : 'Copy'}</span>
                        </button>
                      </div>

                      {/* Answer Content */}
                      {item.loading && !item.answer ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', padding: '12px 0' }}>
                          <RefreshCw size={18} className="spin" color="#06b6d4" />
                          <span>Searching knowledge base & synthesizing response...</span>
                        </div>
                      ) : (
                        <div className="streamed-answer-box">
                          {renderFormattedAnswer(item.answer)}
                          {item.streaming && <span className="streaming-cursor">▍</span>}
                        </div>
                      )}

                      {/* Source Citations */}
                      {item.citations && item.citations.length > 0 && (
                        <div className="citations-wrapper">
                          <div className="citations-title">
                            <ShieldCheck size={14} /> Source Citations ({item.citations.length})
                          </div>
                          {item.citations.map((cite, cIdx) => (
                            <div key={cIdx} className="citation-card">
                              <div className="citation-header-row">
                                <span className="citation-doc-badge">
                                  📄 {cite.document_name}
                                </span>
                                <span className="citation-page-badge">
                                  Page {cite.page_number}
                                </span>
                              </div>
                              <div className="citation-snippet">
                                "{cite.passage}"
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Performance & Token Metrics */}
                      {item.usage && (
                        <div className="metrics-row">
                          <div className="metrics-group">
                            <span className="metric-item">⚡ {item.usage.latency_ms} ms</span>
                            <span className="metric-item">📊 {item.usage.total_tokens || 0} tokens</span>
                            <span className="metric-item">💎 ${Number(item.usage.estimated_cost_usd || 0).toFixed(6)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Bottom Question Input */}
            <form onSubmit={handleAsk} className="chat-input-bar">
              <div className="chat-input-wrapper">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Ask a question grounded in your documents..."
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  disabled={asking}
                />
              </div>
              <button
                type="submit"
                className="btn-send"
                disabled={asking || !question.trim()}
              >
                {asking ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                <span>Ask</span>
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
