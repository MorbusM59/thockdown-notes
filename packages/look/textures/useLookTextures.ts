import { useMemo } from 'react';
import { hsvaToRgba, rgbaToCssColor } from '../colorMath';
import type { TextureMaterialSettings, TextureMaterialsBySurface, TextureSurfaceKey } from '../textureTypes';
import { useTextureSurface } from './useTextureSurface';
import { useTintedTexture } from './useTintedTexture';

/** A material's tint, as the CSS colour its masked layer is painted in. */
export function textureTintOf(material: TextureMaterialSettings): string {
  return rgbaToCssColor(hsvaToRgba(material.color));
}

/**
 * Every image a look's textures need, in the form `prepareLookTextures` takes:
 * each surface's mask, and the sidebar material composed under its tint for
 * the backdrop panels (`useTintedTexture`). A layout switch prepares exactly
 * this list before it applies the look, so its first render finds every image
 * `useLookTextures` will ask for already in the store.
 */
export function lookTextureRequests(materials: TextureMaterialsBySurface): Array<{ surface: TextureSurfaceKey; material: TextureMaterialSettings; tintCss?: string }> {
  return [
    { surface: 'appGrid', material: materials.appGrid },
    { surface: 'sidebarContent', material: materials.sidebarContent, tintCss: textureTintOf(materials.sidebarContent) },
    { surface: 'editorEditText', material: materials.editorEditText },
    { surface: 'editorRenderText', material: materials.editorRenderText },
  ];
}

/** The CSS custom properties a look's textures are drawn with, by the stylesheets that read them. */
export interface LookTextureVariables {
  '--texture-app-grid': string;
  '--texture-sidebar-content': string;
  '--texture-editor-edit': string;
  '--texture-editor-render': string;
  '--texture-app-grid-tint': string;
  '--texture-sidebar-content-tint': string;
  '--backdrop-texture': string;
  '--texture-editor-edit-tint': string;
  '--texture-editor-render-tint': string;
}

/**
 * A look's textures as the CSS custom properties every textured surface reads
 * (the app grid, the sidebar's masked layer, the backdrop panels, the edit and
 * render views, the visualizer), for both apps: the desktop puts them on its
 * shell, the phone on its own. Each surface is one image from the texture
 * store, generated once per material and kept in the app's persistent cache.
 */
export function useLookTextures(materials: TextureMaterialsBySurface, enabled: boolean): LookTextureVariables {
  const appGrid = useTextureSurface({ enabled, surface: 'appGrid', material: materials.appGrid });
  const sidebar = useTextureSurface({ enabled, surface: 'sidebarContent', material: materials.sidebarContent });
  const editorEdit = useTextureSurface({ enabled, surface: 'editorEditText', material: materials.editorEditText });
  const editorRender = useTextureSurface({ enabled, surface: 'editorRenderText', material: materials.editorRenderText });
  const appGridTint = useMemo(() => textureTintOf(materials.appGrid), [materials.appGrid]);
  const sidebarTint = useMemo(() => textureTintOf(materials.sidebarContent), [materials.sidebarContent]);
  const editorEditTint = useMemo(() => textureTintOf(materials.editorEditText), [materials.editorEditText]);
  const editorRenderTint = useMemo(() => textureTintOf(materials.editorRenderText), [materials.editorRenderText]);
  // The sidebar's material, composed into one image for every backdrop panel
  // that does not scroll (useTintedTexture.ts).
  const backdrop = useTintedTexture({ enabled, surface: 'sidebarContent', material: materials.sidebarContent, tintCss: sidebarTint });
  return useMemo(() => ({
    '--texture-app-grid': appGrid,
    '--texture-sidebar-content': sidebar,
    '--texture-editor-edit': editorEdit,
    '--texture-editor-render': editorRender,
    '--texture-app-grid-tint': appGridTint,
    '--texture-sidebar-content-tint': sidebarTint,
    '--backdrop-texture': backdrop,
    '--texture-editor-edit-tint': editorEditTint,
    '--texture-editor-render-tint': editorRenderTint,
  }), [appGrid, sidebar, editorEdit, editorRender, appGridTint, sidebarTint, backdrop, editorEditTint, editorRenderTint]);
}
