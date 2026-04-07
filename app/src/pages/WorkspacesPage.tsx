import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '../api/workspaces';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { useAuthStore } from '../store/authSlice';

export function WorkspacesPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { workspaces, currentWorkspace, setCurrentWorkspace, addWorkspace } = useWorkspaceStore();

  const { data: workspacesData, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspacesApi.list(),
  });

  const { data: membersData } = useQuery({
    queryKey: ['workspace-members', selectedWorkspaceId],
    queryFn: () => workspacesApi.getMembers(selectedWorkspaceId!),
    enabled: !!selectedWorkspaceId && showMembersModal,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => workspacesApi.create(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      addWorkspace({ ...data.workspace, role: 'owner' });
      setShowCreateModal(false);
      setWorkspaceName('');
    },
  });

  const inviteMutation = useMutation({
    mutationFn: ({ id, email }: { id: number; email?: string }) =>
      workspacesApi.createInvite(id, email, 'member'),
    onSuccess: (data) => {
      setInviteLink(data.invite_link);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ workspaceId, userId }: { workspaceId: number; userId: number }) =>
      workspacesApi.removeMember(workspaceId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
    },
  });

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    if (workspaceName.trim()) {
      createMutation.mutate(workspaceName.trim());
    }
  };

  const handleGenerateInvite = (workspaceId: number) => {
    setSelectedWorkspaceId(workspaceId);
    setInviteEmail('');
    setInviteLink('');
    setShowInviteModal(true);
  };

  const handleSendInvite = () => {
    if (selectedWorkspaceId) {
      inviteMutation.mutate({ id: selectedWorkspaceId, email: inviteEmail || undefined });
    }
  };

  const handleViewMembers = (workspaceId: number) => {
    setSelectedWorkspaceId(workspaceId);
    setShowMembersModal(true);
  };

  const handleRemoveMember = (userId: number) => {
    if (selectedWorkspaceId && confirm('Remove this member from the workspace?')) {
      removeMemberMutation.mutate({ workspaceId: selectedWorkspaceId, userId });
    }
  };

  const displayWorkspaces = workspacesData?.workspaces || workspaces;

  return (
    <div>
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Workspaces</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Manage your workspaces and team members
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined">add</span>
          Create Workspace
        </button>
      </header>

      {/* Workspaces Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : displayWorkspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-surface-container-lowest rounded-xl">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">workspaces</span>
          <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspaces Yet</h2>
          <p className="text-on-surface-variant mt-2 mb-6">Create your first workspace to get started</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            Create Workspace
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className={`bg-surface-container-lowest p-6 rounded-xl border-2 transition-all ${
                currentWorkspace?.id === ws.id
                  ? 'border-primary-container'
                  : 'border-transparent hover:border-surface-container'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary-container/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-2xl">workspaces</span>
                </div>
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-bold uppercase ${
                    ws.role === 'owner'
                      ? 'bg-primary-container/10 text-primary'
                      : ws.role === 'admin'
                      ? 'bg-secondary-container text-secondary'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {ws.role}
                </span>
              </div>

              <h3 className="text-lg font-headline font-bold mb-1">{ws.name}</h3>
              <p className="text-sm text-on-surface-variant mb-4">
                Created {new Date(ws.created_at).toLocaleDateString()}
              </p>

              <div className="flex gap-2">
                {currentWorkspace?.id !== ws.id && (
                  <button
                    onClick={() => setCurrentWorkspace(ws)}
                    className="flex-1 py-2 rounded-lg bg-surface-container-low text-sm font-medium hover:bg-surface-container"
                  >
                    Select
                  </button>
                )}
                {currentWorkspace?.id === ws.id && (
                  <span className="flex-1 py-2 rounded-lg bg-primary-container/10 text-primary text-sm font-medium text-center">
                    Active
                  </span>
                )}
                <button
                  onClick={() => handleViewMembers(ws.id)}
                  className="p-2 rounded-lg bg-surface-container-low hover:bg-surface-container"
                  title="View Members"
                >
                  <span className="material-symbols-outlined text-xl">group</span>
                </button>
                {(ws.role === 'owner' || ws.role === 'admin') && (
                  <button
                    onClick={() => handleGenerateInvite(ws.id)}
                    className="p-2 rounded-lg bg-surface-container-low hover:bg-surface-container"
                    title="Invite Members"
                  >
                    <span className="material-symbols-outlined text-xl">person_add</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">Create Workspace</h2>
            <form onSubmit={handleCreateWorkspace}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Workspace Name</label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="e.g., Personal Finance, Business Expenses"
                  required
                />
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">Invite to Workspace</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-on-surface-variant mb-1">
                Email (optional)
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                placeholder="member@example.com"
              />
              <p className="text-xs text-on-surface-variant mt-1">
                Leave empty to generate a shareable invite link
              </p>
            </div>

            {inviteLink && (
              <div className="mb-6 p-4 bg-primary-container/10 rounded-lg">
                <p className="text-sm font-medium text-on-surface-variant mb-2">Invite Link</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="flex-1 px-3 py-2 rounded-lg bg-surface-container-lowest border text-sm"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteLink)}
                    className="px-3 py-2 rounded-lg bg-primary-container text-white text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteLink('');
                }}
                className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
              >
                Close
              </button>
              {!inviteLink && (
                <button
                  onClick={handleSendInvite}
                  disabled={inviteMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {inviteMutation.isPending ? 'Generating...' : 'Generate Link'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {showMembersModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">Workspace Members</h2>

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {membersData?.members?.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-surface-container-low rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-white font-bold">
                      U
                    </div>
                    <div>
                      <p className="font-medium">User #{member.user_id}</p>
                      <p className="text-xs text-on-surface-variant">{member.role}</p>
                    </div>
                  </div>
                  {member.role !== 'owner' && member.user_id !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="text-error hover:bg-error/10 p-2 rounded-lg"
                    >
                      <span className="material-symbols-outlined">remove</span>
                    </button>
                  )}
                </div>
              ))}
              {(!membersData?.members || membersData.members.length === 0) && (
                <p className="text-center text-on-surface-variant py-8">No members found</p>
              )}
            </div>

            <button
              onClick={() => setShowMembersModal(false)}
              className="w-full mt-6 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
