#[path = "../docs/examples/napplet.rs"]
mod napplet;
#[path = "../docs/examples/napplet_bevy.rs"]
mod napplet_bevy;
use bevy::prelude::*;
use wasm_bindgen::prelude::*;

#[derive(Component)]
struct Flower;
#[derive(Resource)]
struct ProofImage(Handle<Image>);
fn main() {
    App::new()
        .add_plugins(napplet_bevy::NappletAssets)
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                canvas: Some("#game".into()),
                fit_canvas_to_parent: true,
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb(0.098, 0.184, 0.173)))
        .add_systems(Startup, (setup, setup_scene))
        .add_systems(Update, animate)
        .run();
}
#[cfg(not(feature = "scene3d"))]
fn setup_scene(mut commands: Commands, assets: Res<AssetServer>) {
    commands.spawn(Camera2d);
    for i in 0..7 {
        commands.spawn((
            Sprite::from_color(
                Color::srgb(0.95, 0.67 + i as f32 * 0.03, 0.38),
                Vec2::splat(34.),
            ),
            Transform::from_xyz((i as f32 - 3.) * 54., 0., 0.),
            Flower,
        ));
    }
    if let Some(meta) = web_sys::window()
        .unwrap()
        .document()
        .unwrap()
        .query_selector("meta[name=proof-resource]")
        .unwrap()
    {
        let hash = meta.get_attribute("content").unwrap();
        let image = assets.load(format!("napplet://{hash}.png"));
        commands.spawn((
            Sprite {
                image: image.clone(),
                custom_size: Some(Vec2::splat(96.)),
                ..default()
            },
            Transform::from_xyz(0., -130., 1.),
        ));
        commands.insert_resource(ProofImage(image));
    }
}
#[cfg(feature = "scene3d")]
fn setup_scene(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.spawn((
        Camera3d::default(),
        // Default AgX needs LUT assets; use an explicitly LUT-free profile.
        bevy::core_pipeline::tonemapping::Tonemapping::None,
        Transform::from_xyz(0., 3., 16.).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    let meta = web_sys::window()
        .unwrap()
        .document()
        .unwrap()
        .query_selector("meta[name=proof-resource]")
        .unwrap()
        .unwrap();
    let image = assets.load(format!(
        "napplet://{}.png",
        meta.get_attribute("content").unwrap()
    ));
    let material = materials.add(StandardMaterial {
        base_color_texture: Some(image.clone()),
        unlit: true,
        ..default()
    });
    let mesh = meshes.add(Cuboid::new(1., 1., 1.));
    for i in 0..3 {
        commands.spawn((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            Transform::from_xyz((i as f32 - 1.) * 2., 0., 0.),
            Flower,
        ));
    }
    commands.insert_resource(ProofImage(image));
}
fn setup() {
    wasm_bindgen_futures::spawn_local(async {
        match napplet::call("config", "get", &[]).await {
            Ok(_) => {
                web_sys::window()
                    .unwrap()
                    .document()
                    .unwrap()
                    .document_element()
                    .unwrap()
                    .set_attribute("data-config", "ok")
                    .unwrap();
            }
            Err(e) => status(&napplet::error_message(e)),
        }
        match napplet::call("storage", "getItem", &["visits".into()]).await {
            Ok(value) => status(&format!(
                "Saved visits: {}",
                value.as_string().unwrap_or("0".into())
            )),
            Err(e) => status(&napplet::error_message(e)),
        }
    });
}
fn animate(
    time: Res<Time>,
    mut flowers: Query<&mut Transform, With<Flower>>,
    mut frames: Local<u32>,
    image: Option<Res<ProofImage>>,
    images: Res<Assets<Image>>,
) {
    *frames += 1;
    for (i, mut t) in flowers.iter_mut().enumerate() {
        #[cfg(not(feature = "scene3d"))]
        {
            t.translation.y = (time.elapsed_secs() + i as f32 * 0.6).sin() * 55.;
            t.rotation = Quat::from_rotation_z(time.elapsed_secs() * 0.25 + i as f32);
        }
        #[cfg(feature = "scene3d")]
        {
            t.translation.y = (time.elapsed_secs() + i as f32 * 0.6).sin() * 0.5;
            t.rotation = Quat::from_euler(
                EulerRot::XYZ,
                time.elapsed_secs() * 0.3,
                time.elapsed_secs() * 0.45,
                0.,
            );
        }
    }
    if *frames >= 30 && image.as_ref().is_none_or(|i| images.contains(&i.0)) {
        let root = web_sys::window()
            .unwrap()
            .document()
            .unwrap()
            .document_element()
            .unwrap();
        root.set_attribute("data-napplet-ready", "true").unwrap();
        if image.is_some() {
            root.set_attribute("data-resource", "ok").unwrap();
        }
    }
}
fn status(message: &str) {
    web_sys::window()
        .unwrap()
        .document()
        .unwrap()
        .get_element_by_id("status")
        .unwrap()
        .set_text_content(Some(message));
}
#[wasm_bindgen]
pub async fn save_visit() -> Result<(), JsValue> {
    let old = napplet::call("storage", "getItem", &["visits".into()])
        .await?
        .as_string()
        .unwrap_or_default()
        .parse::<u32>()
        .unwrap_or(0);
    let next = (old + 1).to_string();
    napplet::call(
        "storage",
        "setItem",
        &["visits".into(), next.clone().into()],
    )
    .await?;
    status(&format!("Saved visits: {next}"));
    Ok(())
}
