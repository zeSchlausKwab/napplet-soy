#!/usr/bin/env python3
"""Private, versioned state snapshots. Restore only into a new directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile

SERVICES = ('relay', 'blossom', 'grasp', 'index', 'moderation', 'community', 'cvm')
CONFIG = ('server.env', 'admin-pubkeys', 'deploy-profile')

def digest(file):
    h = hashlib.sha256()
    while chunk := file.read(1024 * 1024): h.update(chunk)
    return h.hexdigest()

def snapshot(state, shared, destination, release):
    destination.mkdir(mode=0o700)  # Refuse overwriting a snapshot.
    try:
        for service in SERVICES:
            source = state / service
            if not source.is_dir() or source.is_symlink(): raise ValueError('Missing or linked service state: ' + service)
            for path in source.rglob('*'):
                if path.is_symlink() or not (path.is_file() or path.is_dir()): raise ValueError('Unsupported state file type')
            shutil.copytree(source, destination / 'state' / service)
        (destination / 'shared').mkdir(mode=0o700)
        for name in CONFIG:
            source = shared / name
            if source.exists():
                if not source.is_file() or source.is_symlink(): raise ValueError('Unsupported shared configuration')
                shutil.copy2(source, destination / 'shared' / name)
        (destination / 'release.json').write_text(json.dumps({'schema': 1, 'release': release}) + '\n')
    except BaseException:
        shutil.rmtree(destination)
        raise

def pack(source, archive):
    if archive.exists(): raise ValueError('Archive already exists')
    files = {}
    for path in sorted(source.rglob('*')):
        if path.is_symlink(): raise ValueError('Symlinks cannot be backed up')
        if path.is_file():
            with path.open('rb') as file: checksum = digest(file)
            files[path.relative_to(source).as_posix()] = {'size': path.stat().st_size, 'sha256': checksum}
    manifest = {'schema': 1, 'files': files}
    (source / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
    with tarfile.open(archive, 'w:gz', compresslevel=3) as tar:
        for name in ['manifest.json', *files]: tar.add(source / name, arcname=name, recursive=False)
    os.chmod(archive, 0o600)
    with archive.open('rb') as file: checksum = digest(file)
    archive.with_name(archive.name + '.sha256').write_text(checksum + '  ' + archive.name + '\n')
    os.chmod(archive.with_name(archive.name + '.sha256'), 0o600)

def restore(archive, destination=None):
    # Verify before creating the target; interrupted restore never replaces production state.
    expected = archive.with_name(archive.name + '.sha256').read_text().split()[0]
    with archive.open('rb') as file:
        if digest(file) != expected: raise ValueError('Archive checksum mismatch')
    if destination is not None and (destination.exists() or destination.is_symlink()): raise ValueError('Restore destination must not exist')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 100001 or sum(m.size for m in members) > 100 * 1024**3: raise ValueError('Archive exceeds restore limits')
        names = [m.name for m in members]
        if len(set(names)) != len(names): raise ValueError('Duplicate archive paths')
        for member in members:
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or str(path) != member.name: raise ValueError('Unsafe archive entry')
            if member.name not in ('manifest.json', 'release.json') and not (path.parts[0] == 'state' and len(path.parts) >= 3 and path.parts[1] in SERVICES) and not (len(path.parts) == 2 and path.parts[0] == 'shared' and path.parts[1] in CONFIG): raise ValueError('Unexpected archive path')
        manifest_member = tar.getmember('manifest.json')
        if manifest_member.size > 32 * 1024**2: raise ValueError('Oversized manifest')
        manifest = json.load(tar.extractfile(manifest_member))
        if manifest.get('schema') != 1 or set(manifest['files']) != set(names) - {'manifest.json'}: raise ValueError('Invalid backup manifest')
        for name, record in manifest['files'].items():
            member = tar.getmember(name)
            if member.size != record['size'] or digest(tar.extractfile(member)) != record['sha256']: raise ValueError('State checksum mismatch')
        if destination is not None:
            staging = Path(tempfile.mkdtemp(prefix='.napplet-restore-', dir=destination.parent))
            try:
                for service in SERVICES: (staging / 'state' / service).mkdir(parents=True, mode=0o700)
                (staging / 'shared').mkdir(mode=0o700)
                for member in members:
                    output = staging / member.name
                    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with output.open('xb') as file: shutil.copyfileobj(tar.extractfile(member), file)
                    os.chmod(output, 0o600)
                os.rename(staging, destination)
            finally:
                if staging.exists(): shutil.rmtree(staging)
        return {'verified': True, 'files': len(manifest['files']), 'restored': destination is not None}

if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['snapshot', 'pack', 'verify', 'restore'])
    parser.add_argument('--state', type=Path)
    parser.add_argument('--shared', type=Path)
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--release')
    args = parser.parse_args()
    if args.command == 'snapshot': snapshot(args.state, args.shared, args.destination, args.release)
    elif args.command == 'pack': pack(args.snapshot, args.archive)
    else: print(json.dumps(restore(args.archive, args.destination if args.command == 'restore' else None)))
